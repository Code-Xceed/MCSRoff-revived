'use strict';

const crypto = require('crypto');
const { sanitizeDisplayText } = require('../utils/web');
const { fetchFsgSeed } = require('../services/fsgService');
const { createAuditLogEntry } = require('../utils/runtimeRecords');

async function matchmakerRoutes(fastify) {
  const { repositories, matchService, matchWsHub, authService } = fastify;

  // ── POST /matchmaker ── Main action-dispatched endpoint
  fastify.post('/matchmaker', {
    schema: {
      body: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'join_queue', 'poll_match', 'cancel_queue',
              'begin_world_load', 'mark_world_loaded', 'mark_world_generated',
              'mark_ready_locked', 'mark_ready',
              'report_activity', 'heartbeat',
              'report_finish', 'forfeit_match'
            ]
          },
          match_id: { type: 'string', maxLength: 36 },
          seed_mode: { type: 'string', maxLength: 12 },
          seed_type_label: { type: 'string', maxLength: 48 },
          filter_ids: { type: 'array', items: { type: 'string', maxLength: 32 }, maxItems: 10 },
          type: { type: 'string', maxLength: 24 },
          activity_key: { type: 'string', maxLength: 96 },
          status_text: { type: 'string', maxLength: 64 },
          chat_message: { type: 'string', maxLength: 128 },
          advancement_id: { type: 'string', maxLength: 128 },
          finish_time_ms: { type: 'number' }
        },
        required: ['action']
      }
    },
    preHandler: [fastify.matchRateLimit, fastify.requireModAuth]
  }, async (request, reply) => {
    const user = request.user;
    const body = request.body;
    const action = body.action;

    // Cleanup stale state on every request
    const changedMatches = await matchService.cleanupMatchmakerState();
    publishResolvedMatches(changedMatches);

    switch (action) {
      case 'join_queue':
        return handleJoinQueue(reply, user, body);
      case 'poll_match':
        return handlePollMatch(reply, user, body);
      case 'cancel_queue':
        return handleCancelQueue(reply, user);
      case 'begin_world_load':
        return handleBeginWorldLoad(reply, user, body);
      case 'mark_world_loaded':
      case 'mark_world_generated':
        return handleMarkWorldLoaded(reply, user, body);
      case 'mark_ready_locked':
      case 'mark_ready':
        return handleMarkReadyLocked(reply, user, body);
      case 'report_activity':
        return handleReportActivity(reply, user, body);
      case 'heartbeat':
        return handleHeartbeat(reply, user, body);
      case 'report_finish':
        return handleReportFinish(reply, user, body);
      case 'forfeit_match':
        return handleForfeitMatch(reply, user, body);
      default:
        return reply.status(400).send({ error: 'Unknown action' });
    }
  });

  // ── WebSocket: /ws/match/:matchId ──
  fastify.get('/ws/match/:matchId', {
    websocket: true,
    preHandler: [fastify.requireModAuth]
  }, async (socket, request) => {
    const user = request.user;
    const matchId = request.params.matchId;

    // Cleanup
    await matchService.cleanupMatchmakerState();

    // Find the match
    let match = await matchService.requireOwnedMatch(user.id, matchId);
    if (!match) {
      match = await matchService.findActiveMatchForUser(user.id);
    }
    if (!match) {
      socket.send(JSON.stringify({ type: 'error', code: 'match_not_found' }));
      socket.close(4004, 'match_not_found');
      return;
    }

    // Touch presence
    matchService.touchMatchPlayer(match, user.id);
    match = await matchService.persistMatchState(match);

    // Subscribe to room
    const snapshot = matchService.buildSnapshotResponse('matched', match);
    matchWsHub.subscribe(match.id, socket, snapshot);

    // Handle incoming messages from client
    socket.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'heartbeat') {
          const freshMatch = await matchService.requireOwnedMatch(user.id, match.id);
          if (freshMatch) {
            await matchService.heartbeatMatch(freshMatch, user.id);
          }
        }
      } catch { /* ignore malformed messages */ }
    });
  });

  // ── Legacy SSE endpoint (backward compat during transition) ──
  fastify.get('/mod-stream/match', {
    preHandler: [fastify.requireModAuth]
  }, async (request, reply) => {
    const user = request.user;
    await matchService.cleanupMatchmakerState();

    const matchId = request.query.match_id || '';
    let match = matchId ? await matchService.requireOwnedMatch(user.id, matchId) : null;
    if (!match) match = await matchService.findActiveMatchForUser(user.id);
    if (!match) {
      return reply.status(404).send({ error: 'Match not found' });
    }

    matchService.touchMatchPlayer(match, user.id);
    match = await matchService.persistMatchState(match);

    // SSE response
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    reply.raw.write('retry: 1500\n\n');

    const snapshot = matchService.buildSnapshotResponse('matched', match);
    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

    // Subscribe via WS hub internally (SSE wrapper)
    const interval = setInterval(() => {
      try { reply.raw.write(': keepalive\n\n'); }
      catch { clearInterval(interval); }
    }, 15000);

    request.raw.on('close', () => clearInterval(interval));
    reply.hijack();
  });

  // ── Handlers ──

  async function handleJoinQueue(reply, user, body) {
    const now = Date.now();
    const activeMatch = await matchService.findActiveMatchForUser(user.id);
    if (activeMatch) {
      matchService.touchMatchPlayer(activeMatch, user.id);
      const refreshed = await matchService.persistMatchState(activeMatch);
      return sendSnapshot(reply, refreshed);
    }

    const seedMode = matchService.normalizeSeedMode(body.seed_mode);
    const filterIds = matchService.sanitizeFilterIds(body.filter_ids);
    if (filterIds.length === 0) {
      return reply.status(400).send({ error: 'At least one filter id is required' });
    }

    const existingEntry = typeof repositories.queueEntries.findByPlayerId === 'function'
      ? await repositories.queueEntries.findByPlayerId(user.id)
      : await repositories.queueEntries.findSearchingByPlayerId(user.id);

    if (existingEntry && existingEntry.status === 'matched') {
      const claimedMatchId = existingEntry.claimedMatchId || '';
      if (claimedMatchId) {
        const claimedMatch = await matchService.findMatchById(claimedMatchId);
        if (claimedMatch && matchService.findMatchPlayer(claimedMatch, user.id)) {
          matchService.touchMatchPlayer(claimedMatch, user.id);
          const refreshed = await matchService.persistMatchState(claimedMatch);
          return sendSnapshot(reply, refreshed);
        }
      }
      return reply.send({ queue_status: 'searching' });
    }

    const ownEntry = {
      id: existingEntry && existingEntry.status === 'searching' ? existingEntry.id : crypto.randomUUID(),
      playerId: user.id,
      username: user.username,
      displayName: user.displayName,
      elo: user.elo,
      rankTier: user.rankTier,
      seedMode,
      seedTypeLabel: sanitizeDisplayText(body.seed_type_label, 48) || 'Random FSG Race Pool',
      filterIds,
      status: 'searching',
      claimedMatchId: '',
      createdAt: existingEntry && existingEntry.status === 'searching' ? existingEntry.createdAt : now,
      updatedAt: now,
      lastSeenAt: now,
      expiresAt: now + (2 * 60 * 1000)
    };

    await repositories.queueEntries.upsertSearching(ownEntry);
    const provisionalMatchId = crypto.randomUUID();

    let opponent = null;
    if (typeof repositories.queueEntries.claimCompatibleOpponent === 'function') {
      opponent = await repositories.queueEntries.claimCompatibleOpponent(ownEntry, provisionalMatchId, now, 60000);
    } else {
      const allEntries = await repositories.queueEntries.getAll();
      opponent = matchService.findCompatibleQueueEntry(allEntries.filter((e) => e.playerId !== user.id), ownEntry);
    }

    if (!opponent) {
      await repositories.auditLogs.insert(createAuditLogEntry(
        user.id, 'matchmaking', 'join_queue_searching', 'queue_entry', ownEntry.id, '',
        { seed_mode: ownEntry.seedMode, filter_ids: ownEntry.filterIds }, now
      ));
      return reply.send({ queue_status: 'searching' });
    }

    const sharedFilters = ownEntry.filterIds.filter((id) => opponent.filterIds.indexOf(id) >= 0);
    try {
      const seedAssignment = await fetchFsgSeed(seedMode, sharedFilters);
      const match = matchService.createMatchFromQueue(ownEntry, opponent, seedAssignment, provisionalMatchId);
      await matchService.appendMatch(match);
      await repositories.queueEntries.removeByPlayerIds([user.id, opponent.playerId]);
      await repositories.auditLogs.insert(createAuditLogEntry(
        user.id, 'matchmaking', 'join_queue_matched', 'match', match.id, match.id,
        { opponent_player_id: opponent.playerId, seed_mode: match.seedMode, filter_ids: match.filterIds }, now
      ));
      return sendSnapshot(reply, match);
    } catch (error) {
      if (typeof repositories.queueEntries.releaseClaim === 'function') {
        await repositories.queueEntries.releaseClaim([user.id, opponent.playerId], provisionalMatchId, now);
      }
      return reply.status(502).send({ error: 'seed_assignment_failed', detail: error.message });
    }
  }

  async function handlePollMatch(reply, user, body) {
    const matchId = typeof body.match_id === 'string' ? body.match_id.trim() : '';
    let match = matchId ? await matchService.requireOwnedMatch(user.id, matchId) : null;
    if (!match) match = await matchService.findActiveMatchForUser(user.id);
    if (!match) return reply.send({ queue_status: 'searching' });

    matchService.touchMatchPlayer(match, user.id);
    match = await matchService.persistMatchState(match);
    return sendSnapshot(reply, match);
  }

  async function handleCancelQueue(reply, user) {
    await repositories.queueEntries.removeByPlayerIds([user.id]);
    let match = await matchService.findActiveMatchForUser(user.id);
    if (match && match.state !== 'running' && match.state !== 'finished') {
      match.state = 'aborted';
      match.abortReason = 'player_cancelled';
      match.updatedAt = Date.now();
      const player = matchService.findMatchPlayer(match, user.id);
      if (player) {
        player.connected = false;
        player.worldStatus = 'disconnected';
        player.updatedAt = Date.now();
      }
      match = await matchService.persistMatchState(match);
      publishResolvedMatches([match]);
    }
    await repositories.auditLogs.insert(createAuditLogEntry(
      user.id, 'matchmaking', 'cancel_queue', 'queue_entry', user.id, match ? match.id : '', { had_active_match: !!match }, Date.now()
    ));
    return reply.send({ queue_status: 'cancelled' });
  }

  async function handleBeginWorldLoad(reply, user, body) {
    let match = await matchService.requireOwnedMatch(user.id, body.match_id);
    if (!match) return reply.status(404).send({ error: 'Match not found' });
    const player = matchService.findMatchPlayer(match, user.id);
    if (!player) return reply.status(404).send({ error: 'Player not found in match' });
    if (isTerminal(match.state) || isStarted(match.state)) return sendSnapshot(reply, match);
    if (worldRank(player.worldStatus) >= worldRank('generating')) return sendSnapshot(reply, match);

    const now = Date.now();
    player.connected = true;
    player.lastSeenAt = now;
    player.worldStatus = 'generating';
    player.updatedAt = now;
    match = await matchService.persistMatchState(match);
    await repositories.auditLogs.insert(createAuditLogEntry(user.id, 'match', 'begin_world_load', 'match', match.id, match.id, {}, now));
    return sendSnapshot(reply, match);
  }

  async function handleMarkWorldLoaded(reply, user, body) {
    let match = await matchService.requireOwnedMatch(user.id, body.match_id);
    if (!match) return reply.status(404).send({ error: 'Match not found' });
    const player = matchService.findMatchPlayer(match, user.id);
    if (!player) return reply.status(404).send({ error: 'Player not found in match' });
    if (isTerminal(match.state) || isStarted(match.state)) return sendSnapshot(reply, match);
    if (worldRank(player.worldStatus) >= worldRank('generated')) return sendSnapshot(reply, match);

    const now = Date.now();
    player.connected = true;
    player.lastSeenAt = now;
    player.worldStatus = 'generated';
    player.updatedAt = now;
    match = await matchService.persistMatchState(match);
    await repositories.auditLogs.insert(createAuditLogEntry(user.id, 'match', 'mark_world_loaded', 'match', match.id, match.id, {}, now));
    return sendSnapshot(reply, match);
  }

  async function handleMarkReadyLocked(reply, user, body) {
    let match = await matchService.requireOwnedMatch(user.id, body.match_id);
    if (!match) return reply.status(404).send({ error: 'Match not found' });
    const player = matchService.findMatchPlayer(match, user.id);
    if (!player) return reply.status(404).send({ error: 'Player not found in match' });
    if (isTerminal(match.state) || isStarted(match.state)) return sendSnapshot(reply, match);
    if (worldRank(player.worldStatus) >= worldRank('ready')) return sendSnapshot(reply, match);

    const now = Date.now();
    player.connected = true;
    player.lastSeenAt = now;
    player.worldStatus = 'ready';
    player.readyAt = now;
    player.updatedAt = now;
    match = await matchService.persistMatchState(match);
    await repositories.auditLogs.insert(createAuditLogEntry(user.id, 'match', 'mark_ready_locked', 'match', match.id, match.id, { countdown_target_epoch_millis: match.countdownTargetEpochMillis || 0 }, now));
    return sendSnapshot(reply, match);
  }

  async function handleReportActivity(reply, user, body) {
    let match = await matchService.requireOwnedMatch(user.id, body.match_id);
    if (!match) return reply.status(404).send({ error: 'Match not found' });
    if (isTerminal(match.state)) return sendSnapshot(reply, match);

    const player = matchService.findMatchPlayer(match, user.id);
    if (!player) return reply.status(404).send({ error: 'Player not found in match' });

    const type = sanitizeDisplayText(body.type, 24) || 'activity';
    const activityKey = sanitizeDisplayText(body.activity_key, 96);
    const statusText = sanitizeDisplayText(body.status_text, 64);
    const chatMessage = sanitizeDisplayText(body.chat_message, 128);
    const advancementId = sanitizeDisplayText(body.advancement_id, 128);
    const now = Date.now();

    matchService.touchMatchPlayer(match, user.id);
    if (statusText) { player.activityStatus = statusText; player.updatedAt = now; }

    if (activityKey || chatMessage) {
      const isDuplicate = Array.isArray(match.events) && match.events.some((e) =>
        e && e.playerId === user.id && e.type === type && e.activityKey === activityKey && (now - Number(e.createdAt || 0)) <= 15000
      );
      if (!Array.isArray(match.events)) match.events = [];
      if (!match.nextEventSeq) match.nextEventSeq = 1;
      if (!isDuplicate) {
        match.events.push({ seq: match.nextEventSeq++, playerId: user.id, type, activityKey, statusText, chatMessage, advancementId, createdAt: now });
        if (match.events.length > 80) match.events = match.events.slice(match.events.length - 80);
      }
    }

    match = await matchService.persistMatchState(match);
    return sendSnapshot(reply, match);
  }

  async function handleHeartbeat(reply, user, body) {
    let match = await matchService.requireOwnedMatch(user.id, body.match_id);
    if (!match) return reply.status(404).send({ error: 'Match not found' });
    if (isTerminal(match.state)) return sendSnapshot(reply, match);

    matchService.touchMatchPlayer(match, user.id);
    match = await matchService.persistMatchState(match);
    return sendSnapshot(reply, match);
  }

  async function handleReportFinish(reply, user, body) {
    let match = await matchService.requireOwnedMatch(user.id, body.match_id);
    if (!match) return reply.status(404).send({ error: 'Match not found' });
    if (isTerminal(match.state)) return sendSnapshot(reply, match);

    const outcome = await matchService.reportMatchFinish(match, user.id, body.finish_time_ms);
    if (!outcome.ok) {
      const code = outcome.code === 'match_not_running' ? 409 : 400;
      return reply.status(code).send({ error: outcome.code });
    }
    return sendSnapshot(reply, outcome.match);
  }

  async function handleForfeitMatch(reply, user, body) {
    let match = await matchService.requireOwnedMatch(user.id, body.match_id);
    if (!match) return reply.status(404).send({ error: 'Match not found' });
    const outcome = await matchService.reportMatchForfeit(match, user.id, 'player_forfeit');
    if (!outcome.ok) return reply.status(400).send({ error: outcome.code });
    return sendSnapshot(reply, outcome.match);
  }

  // ── Helpers ──

  function sendSnapshot(reply, match) {
    const payload = matchService.buildSnapshotResponse('matched', match);
    if (match && match.id) {
      matchWsHub.publish(match.id, payload);
    }
    return reply.send(payload);
  }

  function publishResolvedMatches(matches) {
    if (!Array.isArray(matches)) return;
    for (const match of matches) {
      if (match && match.id) {
        matchWsHub.publish(match.id, matchService.buildSnapshotResponse('matched', match));
      }
    }
  }

  function worldRank(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'generating') return 1;
    if (s === 'generated') return 2;
    if (s === 'ready') return 3;
    if (s === 'running') return 4;
    if (s === 'finished') return 5;
    if (s === 'disconnected') return 6;
    return 0;
  }

  function isTerminal(state) {
    const s = String(state || '').toLowerCase();
    return s === 'finished' || s === 'aborted';
  }

  function isStarted(state) {
    const s = String(state || '').toLowerCase();
    return s === 'countdown' || s === 'running';
  }
}

module.exports = matchmakerRoutes;
