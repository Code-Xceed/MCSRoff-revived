'use strict';

const crypto = require('crypto');
const { createAuditLogEntry, createRatingHistoryEntry } = require('../utils/runtimeRecords');
const PRE_RACE_COUNTDOWN_MILLIS = 10000;

function createMatchService(options) {
  const {
    repositories,
    sanitizeDisplayText,
    rankForElo,
    calculateHeadToHeadRatings,
    matchPlayerStaleMillis,
    matchPrestartStaleMillis,
    matchRunningStaleMillis
  } = options;

  function findCompatibleQueueEntry(queueEntries, requestedEntry) {
    return queueEntries
      .filter((entry) =>
        entry.status === 'searching'
        && entry.expiresAt > Date.now()
        && entry.seedMode === requestedEntry.seedMode
        && intersectFilters(entry.filterIds, requestedEntry.filterIds).length > 0
      )
      .sort((left, right) => left.createdAt - right.createdAt)[0] || null;
  }

  function intersectFilters(left, right) {
    const rightSet = new Set((right || []).map((value) => String(value)));
    return (left || []).filter((value) => rightSet.has(String(value)));
  }

  function sanitizeFilterIds(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    const seen = new Set();
    const ids = [];
    for (const item of value) {
      const text = sanitizeDisplayText(item, 32);
      if (!text || seen.has(text)) {
        continue;
      }
      seen.add(text);
      ids.push(text);
    }
    return ids;
  }

  function normalizeSeedMode(value) {
    return String(value || '').toUpperCase() === 'PRACTICE' ? 'PRACTICE' : 'MATCH';
  }

  function createMatchFromQueue(hostEntry, opponentEntry, seedAssignment, forcedMatchId) {
    const now = Date.now();
    return {
      id: forcedMatchId || crypto.randomUUID(),
      state: 'matched',
      seedMode: hostEntry.seedMode,
      seedTypeLabel: hostEntry.seedTypeLabel,
      filterIds: intersectFilters(hostEntry.filterIds, opponentEntry.filterIds),
      seed: String(seedAssignment.seed || ''),
      fsgFilterId: String(seedAssignment.filterId || ''),
      fsgToken: String(seedAssignment.token || ''),
      countdownTargetEpochMillis: 0,
      abortReason: '',
      winnerPlayerId: '',
      nextEventSeq: 1,
      events: [],
      createdAt: now,
      updatedAt: now,
      players: [
        createMatchPlayer(hostEntry, 'host', now),
        createMatchPlayer(opponentEntry, 'opponent', now)
      ]
    };
  }

  function createMatchPlayer(queueEntry, slot, now) {
    return {
      playerId: queueEntry.playerId,
      username: queueEntry.username,
      displayName: queueEntry.displayName,
      eloSnapshot: queueEntry.elo,
      rankSnapshot: queueEntry.rankTier,
      slot,
      connected: true,
      worldStatus: 'queued',
      activityStatus: 'Started Match',
      lastSeenAt: now,
      readyAt: 0,
      finishedAt: 0,
      finishTimeMs: 0,
      result: '',
      createdAt: now,
      updatedAt: now
    };
  }

  async function appendMatch(match) {
    await repositories.matches.insert(match);
  }

  async function findMatchById(matchId) {
    if (!matchId) {
      return null;
    }
    return repositories.matches.findById(matchId);
  }

  async function findActiveMatchForUser(userId) {
    return repositories.matches.findActiveByUserId(userId);
  }

  function findMatchPlayer(match, userId) {
    return Array.isArray(match.players)
      ? match.players.find((player) => player.playerId === userId) || null
      : null;
  }

  function isMatchActiveState(state) {
    return state === 'matched'
      || state === 'world_generating'
      || state === 'world_generated'
      || state === 'countdown'
      || state === 'running';
  }

  async function requireOwnedMatch(userId, matchId) {
    const match = await findMatchById(typeof matchId === 'string' ? matchId.trim() : '');
    if (!match) {
      return null;
    }
    return findMatchPlayer(match, userId) ? match : null;
  }

  function updateMatchStateFromPlayers(match) {
    normalizeCountdownState(match);
    if (match.state === 'aborted' || match.state === 'finished' || match.state === 'running' || match.state === 'countdown') {
      return;
    }
    if (allPlayersAtLeast(match, 'generated')) {
      match.state = 'world_generated';
      return;
    }
    if (anyPlayerAtLeast(match, 'generated')) {
      match.state = 'world_generating';
      return;
    }
    match.state = 'matched';
  }

  function normalizeCountdownState(match) {
    if (match.state === 'countdown' && match.countdownTargetEpochMillis > 0 && Date.now() >= match.countdownTargetEpochMillis) {
      const now = Date.now();
      match.state = 'running';
      match.updatedAt = now;
      if (Array.isArray(match.players)) {
        match.players.forEach((player) => {
          if (player.worldStatus === 'ready') {
            player.worldStatus = 'running';
            player.updatedAt = now;
          }
        });
      }
    }
  }

  function anyPlayerAtLeast(match, targetStatus) {
    const targetStage = worldStage(targetStatus);
    return Array.isArray(match.players) && match.players.some((player) => worldStage(player.worldStatus) >= targetStage);
  }

  function allPlayersAtLeast(match, targetStatus) {
    const targetStage = worldStage(targetStatus);
    return Array.isArray(match.players)
      && match.players.length === 2
      && match.players.every((player) => worldStage(player.worldStatus) >= targetStage);
  }

  function worldStage(status) {
    if (status === 'ready') {
      return 3;
    }
    if (status === 'generated') {
      return 2;
    }
    if (status === 'generating') {
      return 1;
    }
    if (status === 'running') {
      return 4;
    }
    if (status === 'finished') {
      return 5;
    }
    return 0;
  }

  async function persistMatchState(match) {
    const now = Date.now();
    trimMatchEvents(match);
    normalizeCountdownState(match);
    promoteCountdownIfReady(match, now);
    updateMatchStateFromPlayers(match);
    match.updatedAt = now;
    return repositories.matches.update(match);
  }

  function promoteCountdownIfReady(match, now) {
    if (!Array.isArray(match.players) || match.players.length !== 2) {
      return;
    }
    if (match.state === 'aborted' || match.state === 'finished' || match.state === 'running') {
      return;
    }
    const bothReady = match.players.every((player) => {
      const stage = worldStage(player.worldStatus);
      return stage >= worldStage('ready');
    });
    if (!bothReady) {
      return;
    }
    if (!match.countdownTargetEpochMillis || match.countdownTargetEpochMillis <= now) {
      match.countdownTargetEpochMillis = now + PRE_RACE_COUNTDOWN_MILLIS;
    }
    match.state = 'countdown';
  }

  async function cleanupMatchmakerState() {
    const now = Date.now();
    const changedMatches = [];
    await repositories.queueEntries.pruneSearchingExpiredOrStale(now, matchPlayerStaleMillis);

    const matches = await repositories.matches.getAll();
    const activeMatchIds = new Set(
      matches
        .filter((match) => isMatchActiveState(match.state))
        .map((match) => match.id)
    );
    for (const match of matches) {
      const resolution = await resolvePresenceTimeout(match, now);
      if (resolution === 'finished') {
        continue;
      }
      let changed = resolution === 'aborted';
      const previousState = match.state;
      normalizeCountdownState(match);
      if (match.state !== previousState) {
        match.updatedAt = now;
        changed = true;
      }
      if (changed) {
        const updatedMatch = await repositories.matches.update(match);
        if (updatedMatch) {
          changedMatches.push(updatedMatch);
        }
      }
    }

    const queueEntries = await repositories.queueEntries.getAll();
    const staleClaimedPlayerIds = queueEntries
      .filter((entry) => {
        if (entry.status !== 'matched') {
          return false;
        }
        const hasActiveClaimedMatch = !!entry.claimedMatchId && activeMatchIds.has(entry.claimedMatchId);
        if (hasActiveClaimedMatch) {
          return false;
        }
        const freshnessAnchor = Math.max(Number(entry.updatedAt || 0), Number(entry.lastSeenAt || 0), Number(entry.createdAt || 0));
        return freshnessAnchor <= 0 || (now - freshnessAnchor) > matchPlayerStaleMillis;
      })
      .map((entry) => entry.playerId);
    if (staleClaimedPlayerIds.length > 0) {
      await repositories.queueEntries.removeByPlayerIds(staleClaimedPlayerIds);
    }
    return changedMatches;
  }

  function buildSnapshotResponse(queueStatus, match) {
    if (!match) {
      return { queue_status: queueStatus };
    }

    return {
      queue_status: queueStatus,
      match: {
        id: match.id,
        state: match.state,
        seed_mode: match.seedMode,
        seed_type_label: match.seedTypeLabel,
        seed: match.seed,
        fsg_filter_id: match.fsgFilterId,
        fsg_token: match.fsgToken,
        abort_reason: match.abortReason || '',
        winner_player_id: match.winnerPlayerId || '',
        countdown_target_epoch_millis: match.countdownTargetEpochMillis || 0,
        players: (match.players || []).map((player) => ({
          player_id: player.playerId,
          username: player.username,
          display_name: player.displayName,
          elo_snapshot: player.eloSnapshot,
          rank_snapshot: player.rankSnapshot,
          slot: player.slot,
          world_status: player.worldStatus,
          connected: player.connected !== false,
          activity_status: player.activityStatus || '',
          ready_at: player.readyAt || 0,
          finished_at: player.finishedAt || 0,
          finish_time_ms: player.finishTimeMs || 0,
          result: player.result || ''
        })),
        events: (match.events || []).map((event) => ({
          seq: event.seq || 0,
          player_id: event.playerId || '',
          type: event.type || '',
          activity_key: event.activityKey || '',
          status_text: event.statusText || '',
          chat_message: event.chatMessage || '',
          advancement_id: event.advancementId || '',
          created_at: event.createdAt || 0
        }))
      }
    };
  }

  async function abandonActiveMatchesForUser(userId, reason) {
    const matches = await repositories.matches.getAll();
    for (const match of matches) {
      if (!isMatchActiveState(match.state)) {
        continue;
      }
      const player = findMatchPlayer(match, userId);
      if (!player) {
        continue;
      }
      markMatchAborted(match, reason || 'player_abandoned', userId);
      await repositories.matches.update(match);
    }
  }

  function touchMatchPlayer(match, userId) {
    const player = findMatchPlayer(match, userId);
    if (!player) {
      return null;
    }
    player.connected = true;
    player.lastSeenAt = Date.now();
    player.updatedAt = Date.now();
    return player;
  }

  function expireDisconnectedMatch(match, now) {
    if (!isMatchActiveState(match.state) || !Array.isArray(match.players)) {
      return null;
    }

    const staleMillis = match.state === 'running' ? matchRunningStaleMillis : matchPrestartStaleMillis;
    const stalePlayer = match.players.find((player) => !player.lastSeenAt || (now - player.lastSeenAt) > staleMillis);
    if (!stalePlayer) {
      return null;
    }

    return stalePlayer;
  }

  function markMatchAborted(match, reason, actorUserId) {
    match.state = 'aborted';
    match.abortReason = reason || 'aborted';
    match.countdownTargetEpochMillis = 0;
    match.updatedAt = Date.now();
    if (!Array.isArray(match.players)) {
      return;
    }

    match.players.forEach((player) => {
      if (actorUserId && player.playerId === actorUserId) {
        player.connected = false;
        player.worldStatus = 'disconnected';
        player.activityStatus = 'Disconnected';
      } else if (player.worldStatus !== 'finished') {
        player.activityStatus = 'Opponent disconnected';
      }
      player.updatedAt = Date.now();
    });
  }

  function trimMatchEvents(match) {
    if (!Array.isArray(match.events) || match.events.length <= 80) {
      return;
    }
    match.events = match.events.slice(match.events.length - 80);
  }

  async function heartbeatMatch(match, userId) {
    const player = touchMatchPlayer(match, userId);
    if (!player) {
      return null;
    }
    await persistMatchState(match);
    return player;
  }

  function normalizeFinishTimeMs(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return Math.min(Math.floor(parsed), 24 * 60 * 60 * 1000);
  }

  function pickWinningPlayer(players) {
    if (!Array.isArray(players)) {
      return null;
    }
    const finishedPlayers = players.filter((player) => player.worldStatus === 'finished' && player.finishedAt > 0);
    if (finishedPlayers.length === 0) {
      return null;
    }
    finishedPlayers.sort((left, right) => {
      if ((left.finishTimeMs || 0) !== (right.finishTimeMs || 0)) {
        return (left.finishTimeMs || 0) - (right.finishTimeMs || 0);
      }
      if ((left.finishedAt || 0) !== (right.finishedAt || 0)) {
        return (left.finishedAt || 0) - (right.finishedAt || 0);
      }
      return String(left.slot || '').localeCompare(String(right.slot || ''));
    });
    return finishedPlayers[0] || null;
  }

  async function applyRankedMatchResult(match, winnerPlayerId) {
    if (match.seedMode !== 'MATCH' || !winnerPlayerId || !Array.isArray(match.players) || match.players.length !== 2) {
      return;
    }
    const winnerPlayer = match.players.find((player) => player.playerId === winnerPlayerId) || null;
    const loserPlayer = match.players.find((player) => player.playerId !== winnerPlayerId) || null;
    if (!winnerPlayer || !loserPlayer) {
      return;
    }

    const [winnerUser, loserUser] = await Promise.all([
      repositories.users.findById(winnerPlayer.playerId),
      repositories.users.findById(loserPlayer.playerId)
    ]);
    if (!winnerUser || !loserUser || winnerUser.status !== 'active' || loserUser.status !== 'active') {
      return;
    }

    const previousWinnerElo = winnerUser.elo;
    const previousLoserElo = loserUser.elo;
    const ratings = calculateHeadToHeadRatings(previousWinnerElo, previousLoserElo, 32);
    winnerUser.elo = ratings.winnerElo;
    loserUser.elo = ratings.loserElo;
    winnerUser.rankTier = rankForElo(winnerUser.elo);
    loserUser.rankTier = rankForElo(loserUser.elo);
    winnerUser.updatedAt = Date.now();
    loserUser.updatedAt = Date.now();

    await Promise.all([
      repositories.users.update(winnerUser),
      repositories.users.update(loserUser),
      repositories.ratingHistory.insert(createRatingHistoryEntry(
        winnerUser.id,
        match.id,
        previousWinnerElo,
        winnerUser.elo,
        'ranked_win',
        Date.now()
      )),
      repositories.ratingHistory.insert(createRatingHistoryEntry(
        loserUser.id,
        match.id,
        previousLoserElo,
        loserUser.elo,
        'ranked_loss',
        Date.now()
      ))
    ]);
  }

  async function reportMatchFinish(match, userId, finishTimeMs) {
    normalizeCountdownState(match);
    if (match.state !== 'running') {
      return { ok: false, code: 'match_not_running' };
    }

    const player = findMatchPlayer(match, userId);
    if (!player) {
      return { ok: false, code: 'player_not_found' };
    }
    if (player.worldStatus === 'finished') {
      return { ok: true, match };
    }

    const now = Date.now();
    touchMatchPlayer(match, userId);
    player.worldStatus = 'finished';
    player.activityStatus = 'Completed';
    player.finishedAt = now;
    player.finishTimeMs = normalizeFinishTimeMs(finishTimeMs);
    player.updatedAt = now;

    const winner = pickWinningPlayer(match.players);
    if (!winner) {
      return { ok: false, code: 'winner_not_resolved' };
    }

    match.state = 'finished';
    match.countdownTargetEpochMillis = 0;
    match.abortReason = '';
    match.winnerPlayerId = winner.playerId;
    match.updatedAt = now;

    if (Array.isArray(match.players)) {
      match.players.forEach((entry) => {
        entry.result = entry.playerId === winner.playerId ? 'win' : 'loss';
        if (entry.playerId !== winner.playerId && entry.worldStatus !== 'finished') {
          entry.activityStatus = 'Match complete';
          entry.updatedAt = now;
        }
      });
    }

    if (!Array.isArray(match.events)) {
      match.events = [];
    }
    if (!match.nextEventSeq) {
      match.nextEventSeq = 1;
    }
    match.events.push({
      seq: match.nextEventSeq++,
      playerId: winner.playerId,
      type: 'finish',
      activityKey: 'match_complete',
      statusText: 'Completed',
      chatMessage: `${winner.displayName} completed the match`,
      advancementId: '',
      createdAt: now
    });

    trimMatchEvents(match);
    await applyRankedMatchResult(match, winner.playerId);
    await repositories.auditLogs.insert(createAuditLogEntry(
      userId,
      'match',
      'report_finish',
      'match',
      match.id,
      match.id,
      {
        winner_player_id: winner.playerId,
        finish_time_ms: player.finishTimeMs,
        state: match.state
      },
      now
    ));
    await repositories.matches.update(match);
    return { ok: true, match };
  }

  async function resolvePresenceTimeout(match, now) {
    const stalePlayer = expireDisconnectedMatch(match, now);
    if (!stalePlayer) {
      return null;
    }
    if (match.state === 'running') {
      await finalizeForfeit(match, stalePlayer.playerId, 'presence_timeout', now);
      return 'finished';
    }
    markMatchAborted(match, 'presence_timeout', stalePlayer.playerId);
    return 'aborted';
  }

  async function reportMatchForfeit(match, userId, reason) {
    if (!match || !findMatchPlayer(match, userId)) {
      return { ok: false, code: 'player_not_found' };
    }
    if (match.state === 'finished') {
      return { ok: true, match };
    }
    if (match.state !== 'running') {
      markMatchAborted(match, reason || 'player_forfeit', userId);
      await repositories.auditLogs.insert(createAuditLogEntry(
        userId,
        'match',
        'forfeit_prestart',
        'match',
        match.id,
        match.id,
        { reason: reason || 'player_forfeit' },
        Date.now()
      ));
      await repositories.matches.update(match);
      return { ok: true, match };
    }
    await finalizeForfeit(match, userId, reason || 'player_forfeit', Date.now());
    return { ok: true, match };
  }

  async function finalizeForfeit(match, forfeitingPlayerId, reason, now) {
    if (!Array.isArray(match.players) || match.players.length !== 2) {
      markMatchAborted(match, reason || 'player_forfeit', forfeitingPlayerId);
      await repositories.matches.update(match);
      return;
    }

    const forfeitingPlayer = match.players.find((player) => player.playerId === forfeitingPlayerId) || null;
    const winner = match.players.find((player) => player.playerId !== forfeitingPlayerId) || null;
    if (!forfeitingPlayer || !winner) {
      markMatchAborted(match, reason || 'player_forfeit', forfeitingPlayerId);
      await repositories.matches.update(match);
      return;
    }

    forfeitingPlayer.connected = false;
    forfeitingPlayer.worldStatus = 'disconnected';
    forfeitingPlayer.activityStatus = 'Forfeited';
    forfeitingPlayer.result = 'loss';
    forfeitingPlayer.updatedAt = now;
    winner.activityStatus = 'Opponent forfeited';
    winner.result = 'win';
    winner.updatedAt = now;

    match.state = 'finished';
    match.abortReason = '';
    match.countdownTargetEpochMillis = 0;
    match.winnerPlayerId = winner.playerId;
    match.updatedAt = now;

    if (!Array.isArray(match.events)) {
      match.events = [];
    }
    if (!match.nextEventSeq) {
      match.nextEventSeq = 1;
    }
    match.events.push({
      seq: match.nextEventSeq++,
      playerId: forfeitingPlayerId,
      type: 'forfeit',
      activityKey: reason || 'player_forfeit',
      statusText: 'Forfeited',
      chatMessage: `${forfeitingPlayer.displayName} forfeited the match`,
      advancementId: '',
      createdAt: now
    });
    trimMatchEvents(match);

    await applyRankedMatchResult(match, winner.playerId);
    await repositories.auditLogs.insert(createAuditLogEntry(
      forfeitingPlayerId,
      'match',
      'forfeit_match',
      'match',
      match.id,
      match.id,
      {
        reason: reason || 'player_forfeit',
        winner_player_id: winner.playerId
      },
      now
    ));
    await repositories.matches.update(match);
  }

  return {
    findCompatibleQueueEntry,
    intersectFilters,
    sanitizeFilterIds,
    normalizeSeedMode,
    createMatchFromQueue,
    appendMatch,
    findMatchById,
    findActiveMatchForUser,
    findMatchPlayer,
    requireOwnedMatch,
    persistMatchState,
    cleanupMatchmakerState,
    buildSnapshotResponse,
    abandonActiveMatchesForUser,
    touchMatchPlayer,
    heartbeatMatch,
    reportMatchFinish,
    reportMatchForfeit
  };
}

module.exports = {
  createMatchService
};
