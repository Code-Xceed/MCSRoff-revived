'use strict';

const crypto = require('crypto');
const { createAuditLogEntry } = require('../utils/runtimeRecords');

function createMatchmakingController(options) {
  const {
    repositories,
    sendJson,
    readBody,
    sanitizeDisplayText,
    matchStreamHub,
    fetchFsgSeed,
    getModSessionFromBearer,
    cleanupMatchmakerState,
    normalizeSeedMode,
    sanitizeFilterIds,
    findCompatibleQueueEntry,
    createMatchFromQueue,
    appendMatch,
    buildSnapshotResponse,
    findMatchById,
    findActiveMatchForUser,
    findMatchPlayer,
    requireOwnedMatch,
    touchMatchPlayer,
    persistMatchState,
    reportMatchFinish,
    reportMatchForfeit
  } = options;

  async function handleMatchmaker(request, response) {
    const modSession = await getModSessionFromBearer(request);
    if (!modSession) {
      return sendJson(response, 401, { error: 'Unauthorized' });
    }

    const user = await repositories.users.findById(modSession.userId);
    if (!user || user.status !== 'active') {
      return sendJson(response, 403, { error: 'Account inactive' });
    }

    publishResolvedMatches(await cleanupMatchmakerState());

    const body = await readBody(request);
    const action = typeof body.action === 'string' ? body.action.trim() : '';
    if (!action) {
      return sendJson(response, 400, { error: 'action is required' });
    }

    if (action === 'join_queue') {
      return handleJoinQueue(response, user, body);
    }
    if (action === 'poll_match') {
      return handlePollMatch(response, user, body);
    }
    if (action === 'cancel_queue') {
      return handleCancelQueue(response, user);
    }
    if (action === 'mark_world_generated') {
      return handleMarkWorldGenerated(response, user, body);
    }
    if (action === 'mark_ready') {
      return handleMarkReady(response, user, body);
    }
    if (action === 'report_activity') {
      return handleReportActivity(response, user, body);
    }
    if (action === 'heartbeat') {
      return handleHeartbeat(response, user, body);
    }
    if (action === 'report_finish') {
      return handleReportFinish(response, user, body);
    }
    if (action === 'forfeit_match') {
      return handleForfeitMatch(response, user, body);
    }

    return sendJson(response, 400, { error: 'Unknown action' });
  }

  async function handleMatchStream(request, response) {
    const modSession = await getModSessionFromBearer(request);
    if (!modSession) {
      return sendJson(response, 401, { error: 'Unauthorized' });
    }

    const user = await repositories.users.findById(modSession.userId);
    if (!user || user.status !== 'active') {
      return sendJson(response, 403, { error: 'Account inactive' });
    }

    publishResolvedMatches(await cleanupMatchmakerState());

    const requestUrl = new URL(request.url, 'http://localhost');
    const requestedMatchId = typeof requestUrl.searchParams.get('match_id') === 'string'
      ? requestUrl.searchParams.get('match_id').trim()
      : '';

    let match = null;
    if (requestedMatchId) {
      match = await requireOwnedMatch(user.id, requestedMatchId);
    }
    if (!match) {
      match = await findActiveMatchForUser(user.id);
    }
    if (!match) {
      return sendJson(response, 404, { error: 'Match not found' });
    }

    touchMatchPlayer(match, user.id);
    match = await persistMatchState(match);
    matchStreamHub.subscribe(match.id, request, response, buildSnapshotResponse('matched', match));
  }

  async function handleJoinQueue(response, user, body) {
    const now = Date.now();
    const activeMatch = await findActiveMatchForUser(user.id);
    if (activeMatch) {
      touchMatchPlayer(activeMatch, user.id);
      const refreshedMatch = await persistMatchState(activeMatch);
      return sendSnapshot(response, refreshedMatch);
    }

    const seedMode = normalizeSeedMode(body.seed_mode);
    const filterIds = sanitizeFilterIds(body.filter_ids);
    if (filterIds.length === 0) {
      return sendJson(response, 400, { error: 'At least one filter id is required' });
    }

    const existingQueueEntry = typeof repositories.queueEntries.findByPlayerId === 'function'
      ? await repositories.queueEntries.findByPlayerId(user.id)
      : await repositories.queueEntries.findSearchingByPlayerId(user.id);

    if (existingQueueEntry && existingQueueEntry.status === 'matched') {
      const claimedMatchId = existingQueueEntry.claimedMatchId || '';
      if (claimedMatchId) {
        const claimedMatch = await findMatchById(claimedMatchId);
        if (claimedMatch && findMatchPlayer(claimedMatch, user.id)) {
          touchMatchPlayer(claimedMatch, user.id);
          const refreshedClaimedMatch = await persistMatchState(claimedMatch);
          return sendSnapshot(response, refreshedClaimedMatch);
        }
      }

      if (typeof repositories.queueEntries.touch === 'function') {
        await repositories.queueEntries.touch(user.id, {
          username: user.username,
          displayName: user.displayName,
          elo: user.elo,
          rankTier: user.rankTier,
          seedMode,
          seedTypeLabel: sanitizeDisplayText(body.seed_type_label, 48) || existingQueueEntry.seedTypeLabel || 'Random FSG Race Pool',
          filterIds: filterIds.length > 0 ? filterIds : (existingQueueEntry.filterIds || []),
          lastSeenAt: now,
          updatedAt: now,
          expiresAt: now + (2 * 60 * 1000)
        });
      }
      return sendJson(response, 200, { queue_status: 'searching' });
    }

    const ownQueueEntry = {
      id: existingQueueEntry && existingQueueEntry.status === 'searching' ? existingQueueEntry.id : crypto.randomUUID(),
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
      createdAt: existingQueueEntry && existingQueueEntry.status === 'searching' ? existingQueueEntry.createdAt : now,
      updatedAt: now,
      lastSeenAt: now,
      expiresAt: now + (2 * 60 * 1000)
    };

    await repositories.queueEntries.upsertSearching(ownQueueEntry);
    const provisionalMatchId = crypto.randomUUID();
    let opponentQueue = null;
    if (typeof repositories.queueEntries.claimCompatibleOpponent === 'function') {
      opponentQueue = await repositories.queueEntries.claimCompatibleOpponent(
        ownQueueEntry,
        provisionalMatchId,
        now,
        60 * 1000
      );
    } else {
      await repositories.queueEntries.removeByPlayerIds([user.id]);
      await repositories.queueEntries.upsertSearching(ownQueueEntry);
      const queueEntries = await repositories.queueEntries.getAll();
      opponentQueue = findCompatibleQueueEntry(queueEntries.filter((entry) => entry.playerId !== user.id), ownQueueEntry);
    }

    if (!opponentQueue) {
      await repositories.auditLogs.insert(createAuditLogEntry(
        user.id,
        'matchmaking',
        'join_queue_searching',
        'queue_entry',
        ownQueueEntry.id,
        '',
        {
          seed_mode: ownQueueEntry.seedMode,
          filter_ids: ownQueueEntry.filterIds
        },
        now
      ));
      return sendJson(response, 200, { queue_status: 'searching' });
    }

    const sharedFilters = ownQueueEntry.filterIds.filter((filterId) => opponentQueue.filterIds.indexOf(filterId) >= 0);
    try {
      const seedAssignment = await fetchFsgSeed(seedMode, sharedFilters);
      const match = createMatchFromQueue(ownQueueEntry, opponentQueue, seedAssignment, provisionalMatchId);
      await appendMatch(match);
      await repositories.queueEntries.removeByPlayerIds([user.id, opponentQueue.playerId]);
      await repositories.auditLogs.insert(createAuditLogEntry(
        user.id,
        'matchmaking',
        'join_queue_matched',
        'match',
        match.id,
        match.id,
        {
          opponent_player_id: opponentQueue.playerId,
          seed_mode: match.seedMode,
          filter_ids: match.filterIds
        },
        Date.now()
      ));
      return sendSnapshot(response, match);
    } catch (error) {
      if (typeof repositories.queueEntries.releaseClaim === 'function') {
        await repositories.queueEntries.releaseClaim([user.id, opponentQueue.playerId], provisionalMatchId, Date.now());
      }
      return sendJson(response, 502, { error: 'seed_assignment_failed', detail: error.message || 'Failed to assign seed' });
    }
  }

  async function handlePollMatch(response, user, body) {
    let match = null;
    const requestedMatchId = typeof body.match_id === 'string' ? body.match_id.trim() : '';
    if (requestedMatchId) {
      match = await requireOwnedMatch(user.id, requestedMatchId);
    }
    if (!match) {
      match = await findActiveMatchForUser(user.id);
    }
    if (!match) {
      return sendJson(response, 200, { queue_status: 'searching' });
    }

    match = await touchPlayerPresence(match, user.id);
    match = await persistMatchState(match);
    return sendSnapshot(response, match);
  }

  async function handleCancelQueue(response, user) {
    await repositories.queueEntries.removeByPlayerIds([user.id]);

    let match = await findActiveMatchForUser(user.id);
    if (match && match.state !== 'running' && match.state !== 'finished') {
      match.state = 'aborted';
      match.abortReason = 'player_cancelled';
      match.updatedAt = Date.now();
      const player = findMatchPlayer(match, user.id);
      if (player) {
        player.connected = false;
        player.worldStatus = 'disconnected';
        player.updatedAt = Date.now();
      }
      match = await persistMatchState(match);
      publishResolvedMatches([match]);
    }

    await repositories.auditLogs.insert(createAuditLogEntry(
      user.id,
      'matchmaking',
      'cancel_queue',
      'queue_entry',
      user.id,
      match != null ? match.id : '',
      {
        had_active_match: match != null
      },
      Date.now()
    ));

    return sendJson(response, 200, { queue_status: 'cancelled' });
  }

  async function handleMarkWorldGenerated(response, user, body) {
    let match = await requireOwnedMatch(user.id, body.match_id);
    if (!match) {
      return sendJson(response, 404, { error: 'Match not found' });
    }

    const now = Date.now();
    match = await updatePlayerState(match.id, user.id, {
      connected: true,
      lastSeenAt: now,
      worldStatus: 'generated',
      updatedAt: now
    });
    match = await persistMatchState(match);
    await repositories.auditLogs.insert(createAuditLogEntry(
      user.id,
      'match',
      'mark_world_generated',
      'match',
      match.id,
      match.id,
      {},
      Date.now()
    ));
    return sendSnapshot(response, match);
  }

  async function handleMarkReady(response, user, body) {
    let match = await requireOwnedMatch(user.id, body.match_id);
    if (!match) {
      return sendJson(response, 404, { error: 'Match not found' });
    }

    const now = Date.now();
    match = await updatePlayerState(match.id, user.id, {
      connected: true,
      lastSeenAt: now,
      worldStatus: 'ready',
      readyAt: now,
      updatedAt: now
    });
    match = await persistMatchState(match);
    await repositories.auditLogs.insert(createAuditLogEntry(
      user.id,
      'match',
      'mark_ready',
      'match',
      match.id,
      match.id,
      {
        countdown_target_epoch_millis: match.countdownTargetEpochMillis || 0
      },
      Date.now()
    ));
    return sendSnapshot(response, match);
  }

  async function handleReportActivity(response, user, body) {
    let match = await requireOwnedMatch(user.id, body.match_id);
    if (!match) {
      return sendJson(response, 404, { error: 'Match not found' });
    }

    const player = findMatchPlayer(match, user.id);
    if (!player) {
      return sendJson(response, 404, { error: 'Player not found in match' });
    }

    const type = sanitizeDisplayText(body.type, 24) || 'activity';
    const activityKey = sanitizeDisplayText(body.activity_key, 96);
    const statusText = sanitizeDisplayText(body.status_text, 64);
    const chatMessage = sanitizeDisplayText(body.chat_message, 128);
    const advancementId = sanitizeDisplayText(body.advancement_id, 128);
    const now = Date.now();

    touchMatchPlayer(match, user.id);
    if (statusText) {
      player.activityStatus = statusText;
      player.updatedAt = now;
    }

    if (activityKey || chatMessage) {
      if (!Array.isArray(match.events)) {
        match.events = [];
      }
      if (!match.nextEventSeq) {
        match.nextEventSeq = 1;
      }
      match.events.push({
        seq: match.nextEventSeq++,
        playerId: user.id,
        type,
        activityKey,
        statusText,
        chatMessage,
        advancementId,
        createdAt: now
      });
      if (match.events.length > 80) {
        match.events = match.events.slice(match.events.length - 80);
      }
    }

    match = await persistMatchState(match);
    return sendSnapshot(response, match);
  }

  async function handleHeartbeat(response, user, body) {
    let match = await requireOwnedMatch(user.id, body.match_id);
    if (!match) {
      return sendJson(response, 404, { error: 'Match not found' });
    }

    match = await touchPlayerPresence(match, user.id);
    match = await persistMatchState(match);
    const player = findMatchPlayer(match, user.id);
    if (!player) {
      return sendJson(response, 404, { error: 'Player not found in match' });
    }
    return sendSnapshot(response, match);
  }

  async function updatePlayerState(matchId, playerId, fields) {
    if (typeof repositories.matches.updatePlayer === 'function') {
      const updatedMatch = await repositories.matches.updatePlayer(matchId, playerId, fields);
      if (updatedMatch) {
        return updatedMatch;
      }
    }
    const fallbackMatch = await findMatchById(matchId);
    const player = fallbackMatch ? findMatchPlayer(fallbackMatch, playerId) : null;
    if (player) {
      Object.assign(player, fields);
    }
    return fallbackMatch;
  }

  async function touchPlayerPresence(match, userId) {
    const now = Date.now();
    if (typeof repositories.matches.updatePlayer === 'function') {
      const updatedMatch = await repositories.matches.updatePlayer(match.id, userId, {
        connected: true,
        lastSeenAt: now,
        updatedAt: now
      });
      if (updatedMatch) {
        return updatedMatch;
      }
    }
    touchMatchPlayer(match, userId);
    return match;
  }

  async function handleReportFinish(response, user, body) {
    let match = await requireOwnedMatch(user.id, body.match_id);
    if (!match) {
      return sendJson(response, 404, { error: 'Match not found' });
    }

    const outcome = await reportMatchFinish(match, user.id, body.finish_time_ms);
    if (!outcome.ok) {
      const code = outcome.code === 'match_not_running' ? 409 : 400;
      return sendJson(response, code, { error: outcome.code });
    }
    return sendSnapshot(response, outcome.match);
  }

  async function handleForfeitMatch(response, user, body) {
    let match = await requireOwnedMatch(user.id, body.match_id);
    if (!match) {
      return sendJson(response, 404, { error: 'Match not found' });
    }

    const outcome = await reportMatchForfeit(match, user.id, 'player_forfeit');
    if (!outcome.ok) {
      return sendJson(response, 400, { error: outcome.code });
    }
    return sendSnapshot(response, outcome.match);
  }

  function sendSnapshot(response, match) {
    const payload = buildSnapshotResponse('matched', match);
    if (match && match.id) {
      matchStreamHub.publish(match.id, payload);
    }
    return sendJson(response, 200, payload);
  }

  function publishResolvedMatches(matches) {
    if (!Array.isArray(matches) || matches.length === 0) {
      return;
    }
    for (const match of matches) {
      if (!match || !match.id) {
        continue;
      }
      matchStreamHub.publish(match.id, buildSnapshotResponse('matched', match));
    }
  }

  return {
    handleMatchmaker,
    handleMatchStream
  };
}

module.exports = {
  createMatchmakingController
};
