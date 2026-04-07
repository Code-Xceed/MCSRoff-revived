'use strict';

function createJsonRepositories(store) {
  function worldStatusRank(status) {
    switch (String(status || '').toLowerCase()) {
      case 'queued': return 0;
      case 'generating': return 1;
      case 'generated': return 2;
      case 'ready': return 3;
      case 'running': return 4;
      case 'finished': return 5;
      case 'disconnected': return 6;
      default: return 0;
    }
  }

  function matchStateRank(state) {
    switch (String(state || '').toLowerCase()) {
      case 'matched': return 0;
      case 'world_generating': return 1;
      case 'world_generated': return 2;
      case 'countdown': return 3;
      case 'running': return 4;
      case 'finished': return 5;
      case 'aborted': return 6;
      default: return 0;
    }
  }

  function mergeMatchPlayer(existing, incoming) {
    const left = existing || {};
    const right = incoming || {};
    const leftUpdatedAt = Number(left.updatedAt || 0);
    const rightUpdatedAt = Number(right.updatedAt || 0);
    return {
      playerId: right.playerId || left.playerId || '',
      username: right.username || left.username || '',
      displayName: right.displayName || left.displayName || '',
      eloSnapshot: right.eloSnapshot != null ? right.eloSnapshot : (left.eloSnapshot || 1200),
      rankSnapshot: right.rankSnapshot || left.rankSnapshot || '',
      slot: right.slot || left.slot || '',
      connected: left.connected === false || right.connected === false ? false : (right.connected !== false && left.connected !== false),
      worldStatus: worldStatusRank(right.worldStatus) >= worldStatusRank(left.worldStatus)
        ? (right.worldStatus || left.worldStatus || 'queued')
        : (left.worldStatus || right.worldStatus || 'queued'),
      activityStatus: rightUpdatedAt >= leftUpdatedAt ? (right.activityStatus || left.activityStatus || '') : (left.activityStatus || right.activityStatus || ''),
      lastSeenAt: Math.max(Number(left.lastSeenAt || 0), Number(right.lastSeenAt || 0)),
      readyAt: Math.max(Number(left.readyAt || 0), Number(right.readyAt || 0)),
      finishedAt: Math.max(Number(left.finishedAt || 0), Number(right.finishedAt || 0)),
      finishTimeMs: Math.max(Number(left.finishTimeMs || 0), Number(right.finishTimeMs || 0)),
      result: rightUpdatedAt >= leftUpdatedAt ? (right.result || left.result || '') : (left.result || right.result || ''),
      createdAt: Math.min(Number(left.createdAt || 0) || Number(right.createdAt || 0), Number(right.createdAt || 0) || Number(left.createdAt || 0)),
      updatedAt: Math.max(leftUpdatedAt, rightUpdatedAt)
    };
  }

  function mergeMatch(existing, incoming) {
    if (!existing) {
      return incoming;
    }
    const playersById = new Map();
    (existing.players || []).forEach((player) => playersById.set(player.playerId, player));
    (incoming.players || []).forEach((player) => playersById.set(player.playerId, mergeMatchPlayer(playersById.get(player.playerId), player)));

    const eventsBySeq = new Map();
    (existing.events || []).forEach((event) => eventsBySeq.set(String(event.seq || 0), event));
    (incoming.events || []).forEach((event) => eventsBySeq.set(String(event.seq || 0), event));

    const existingState = String(existing.state || '');
    const incomingState = String(incoming.state || '');
    return {
      id: incoming.id || existing.id,
      state: matchStateRank(incomingState) >= matchStateRank(existingState) ? (incomingState || existingState || 'matched') : (existingState || incomingState || 'matched'),
      seedMode: incoming.seedMode || existing.seedMode || 'MATCH',
      seedTypeLabel: incoming.seedTypeLabel || existing.seedTypeLabel || '',
      filterIds: Array.isArray(incoming.filterIds) && incoming.filterIds.length > 0 ? incoming.filterIds : (existing.filterIds || []),
      seed: incoming.seed || existing.seed || '',
      fsgFilterId: incoming.fsgFilterId || existing.fsgFilterId || '',
      fsgToken: incoming.fsgToken || existing.fsgToken || '',
      countdownTargetEpochMillis: existing.countdownTargetEpochMillis > 0 ? existing.countdownTargetEpochMillis : (incoming.countdownTargetEpochMillis || 0),
      abortReason: incoming.abortReason || existing.abortReason || '',
      winnerPlayerId: incoming.winnerPlayerId || existing.winnerPlayerId || '',
      nextEventSeq: Math.max(Number(existing.nextEventSeq || 1), Number(incoming.nextEventSeq || 1)),
      createdAt: Math.min(Number(existing.createdAt || 0) || Number(incoming.createdAt || 0), Number(incoming.createdAt || 0) || Number(existing.createdAt || 0)),
      updatedAt: Math.max(Number(existing.updatedAt || 0), Number(incoming.updatedAt || 0)),
      players: Array.from(playersById.values()),
      events: Array.from(eventsBySeq.values()).sort((left, right) => (left.seq || 0) - (right.seq || 0))
    };
  }

  const users = {
    getAll: () => store.loadTable('users'),
    saveAll: (rows) => store.saveTable('users', rows),
    insert: (user) => {
      const rows = store.loadTable('users');
      rows.push(user);
      store.saveTable('users', rows);
      return user;
    },
    update: (user) => {
      const rows = store.loadTable('users');
      const index = rows.findIndex((item) => item.id === user.id);
      if (index >= 0) {
        rows[index] = user;
        store.saveTable('users', rows);
      }
      return user;
    },
    listRecent: (limit) => store.loadTable('users')
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, Math.max(0, Number(limit) || 0)),
    findById: (id) => store.loadTable('users').find((user) => user.id === id) || null,
    findByUsernameLower: (usernameLower) => store.loadTable('users').find((user) => user.usernameLower === usernameLower) || null,
    findByDisplayNameLower: (displayNameLower) => store.loadTable('users').find((user) => user.displayNameLower === displayNameLower) || null
  };

  const webSessions = {
    getAll: () => store.loadTable('webSessions'),
    saveAll: (rows) => store.saveTable('webSessions', rows),
    findActiveByToken: (token, now) => store.loadTable('webSessions').find((session) => session.token === token && session.expiresAt > now) || null,
    insert: (session) => {
      const rows = store.loadTable('webSessions').filter((item) => item.expiresAt > Date.now());
      rows.push(session);
      store.saveTable('webSessions', rows);
      return session;
    },
    deleteByToken: (token) => {
      const rows = store.loadTable('webSessions').filter((session) => session.token !== token);
      store.saveTable('webSessions', rows);
    },
    deleteByUserId: (userId) => {
      const rows = store.loadTable('webSessions').filter((session) => session.userId !== userId);
      store.saveTable('webSessions', rows);
    }
  };

  const deviceLinks = {
    getAll: () => store.loadTable('deviceLinks'),
    saveAll: (rows) => store.saveTable('deviceLinks', rows),
    findByUserCode: (userCode) => store.loadTable('deviceLinks').find((item) => item.userCode === userCode) || null,
    findByDeviceCode: (deviceCode) => store.loadTable('deviceLinks').find((item) => item.deviceCode === deviceCode) || null,
    insert: (link) => {
      const rows = store.loadTable('deviceLinks');
      rows.push(link);
      store.saveTable('deviceLinks', rows);
      return link;
    },
    update: (link) => {
      const rows = store.loadTable('deviceLinks');
      const index = rows.findIndex((item) => item.id === link.id);
      if (index >= 0) {
        rows[index] = link;
        store.saveTable('deviceLinks', rows);
      }
      return link;
    },
    listRecentForUser: (userId) => store.loadTable('deviceLinks')
      .filter((item) => item.approvedUserId === userId || item.status === 'pending')
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 6)
  };

  const modSessions = {
    getAll: () => store.loadTable('modSessions'),
    saveAll: (rows) => store.saveTable('modSessions', rows),
    findActiveByAccessToken: (token, now) => store.loadTable('modSessions')
      .find((session) => session.accessToken === token && !session.revokedAt && session.accessExpiresAt > now) || null,
    findById: (id) => store.loadTable('modSessions').find((session) => session.id === id && !session.revokedAt) || null,
    findByRefreshToken: (refreshToken) => store.loadTable('modSessions').find((session) => session.refreshToken === refreshToken) || null,
    replaceActiveForUserScope: (userId, scope, nextSession, now) => {
      const rows = store.loadTable('modSessions').filter((session) => session.refreshExpiresAt > now);
      rows.forEach((session) => {
        if (!session.revokedAt && session.userId === userId && session.scope === scope) {
          session.revokedAt = now;
          session.updatedAt = now;
        }
      });
      rows.push(nextSession);
      store.saveTable('modSessions', rows);
      return nextSession;
    },
    update: (session) => {
      const rows = store.loadTable('modSessions');
      const index = rows.findIndex((item) => item.id === session.id);
      if (index >= 0) {
        rows[index] = session;
        store.saveTable('modSessions', rows);
      }
      return session;
    },
    listActiveByUserId: (userId, now) => store.loadTable('modSessions')
      .filter((session) => session.userId === userId && !session.revokedAt && session.refreshExpiresAt > now),
    revokeByUserId: (userId, now) => {
      const rows = store.loadTable('modSessions');
      rows.forEach((session) => {
        if (session.userId === userId && !session.revokedAt) {
          session.revokedAt = now;
          session.updatedAt = now;
        }
      });
      store.saveTable('modSessions', rows);
    }
  };

  const queueEntries = {
    getAll: () => store.loadTable('queueEntries'),
    saveAll: (rows) => store.saveTable('queueEntries', rows),
    findSearchingByPlayerId: (playerId) => store.loadTable('queueEntries').find((entry) => entry.playerId === playerId && entry.status === 'searching') || null,
    upsertSearching: (entry) => {
      const rows = store.loadTable('queueEntries').filter((item) => item.playerId !== entry.playerId);
      rows.push(entry);
      store.saveTable('queueEntries', rows);
      return entry;
    },
    claimCompatibleOpponent: (requestedEntry, claimMatchId, now, staleMillis) => {
      const rows = store.loadTable('queueEntries');
      const candidate = rows
        .filter((entry) =>
          entry.playerId !== requestedEntry.playerId
          && entry.status === 'searching'
          && entry.seedMode === requestedEntry.seedMode
          && entry.expiresAt > now
          && (!entry.lastSeenAt || (now - entry.lastSeenAt) <= staleMillis)
          && Array.isArray(entry.filterIds)
          && entry.filterIds.some((filterId) => (requestedEntry.filterIds || []).includes(filterId))
        )
        .sort((left, right) => left.createdAt - right.createdAt)[0] || null;
      if (!candidate) {
        return null;
      }

      let updatedCount = 0;
      rows.forEach((entry) => {
        if ((entry.playerId === requestedEntry.playerId || entry.playerId === candidate.playerId) && entry.status === 'searching') {
          entry.status = 'matched';
          entry.claimedMatchId = claimMatchId;
          entry.updatedAt = now;
          updatedCount += 1;
        }
      });
      store.saveTable('queueEntries', rows);
      return updatedCount === 2 ? candidate : null;
    },
    releaseClaim: (playerIds, claimMatchId, now) => {
      const blocked = new Set(playerIds || []);
      const rows = store.loadTable('queueEntries');
      rows.forEach((entry) => {
        if (blocked.has(entry.playerId) && entry.claimedMatchId === claimMatchId) {
          entry.status = 'searching';
          entry.claimedMatchId = '';
          entry.updatedAt = now;
          entry.lastSeenAt = now;
        }
      });
      store.saveTable('queueEntries', rows);
    },
    removeByPlayerIds: (playerIds) => {
      const blocked = new Set(playerIds || []);
      const rows = store.loadTable('queueEntries').filter((entry) => !blocked.has(entry.playerId));
      store.saveTable('queueEntries', rows);
    },
    pruneSearchingExpiredOrStale: (now, staleMillis) => {
      const rows = store.loadTable('queueEntries').filter((entry) =>
        entry.expiresAt > now
        && entry.status === 'searching'
        && (!entry.lastSeenAt || (now - entry.lastSeenAt) <= staleMillis)
      );
      store.saveTable('queueEntries', rows);
    }
  };

  const matches = {
    getAll: () => store.loadTable('matches'),
    saveAll: (rows) => store.saveTable('matches', rows),
    findById: (id) => store.loadTable('matches').find((match) => match.id === id) || null,
    insert: (match) => {
      const rows = store.loadTable('matches');
      rows.push(match);
      store.saveTable('matches', rows);
      return match;
    },
    update: (match) => {
      const rows = store.loadTable('matches');
      const index = rows.findIndex((item) => item.id === match.id);
      if (index >= 0) {
        rows[index] = mergeMatch(rows[index], match);
        store.saveTable('matches', rows);
      }
      return rows.find((item) => item.id === match.id) || match;
    },
    updatePlayer: (matchId, playerId, fields) => {
      const rows = store.loadTable('matches');
      const index = rows.findIndex((item) => item.id === matchId);
      if (index < 0) {
        return null;
      }
      const match = rows[index];
      if (!Array.isArray(match.players)) {
        match.players = [];
      }
      const playerIndex = match.players.findIndex((player) => player.playerId === playerId);
      if (playerIndex < 0) {
        return match;
      }
      match.players[playerIndex] = Object.assign({}, match.players[playerIndex], fields);
      rows[index] = match;
      store.saveTable('matches', rows);
      return rows[index];
    },
    findActiveByUserId: (userId) => {
      const activeStates = new Set(['matched', 'world_generating', 'world_generated', 'countdown', 'running']);
      return store.loadTable('matches').find((match) =>
        activeStates.has(match.state)
        && Array.isArray(match.players)
        && match.players.some((player) => player.playerId === userId)
      ) || null;
    }
  };

  const ratingHistory = {
    getAll: () => store.loadTable('ratingHistory'),
    saveAll: (rows) => store.saveTable('ratingHistory', rows),
    insert: (entry) => {
      const rows = store.loadTable('ratingHistory');
      rows.push(entry);
      store.saveTable('ratingHistory', rows);
      return entry;
    }
  };

  const auditLogs = {
    getAll: () => store.loadTable('auditLogs'),
    saveAll: (rows) => store.saveTable('auditLogs', rows),
    insert: (entry) => {
      const rows = store.loadTable('auditLogs');
      rows.push(entry);
      store.saveTable('auditLogs', rows);
      return entry;
    }
  };

  return {
    users,
    webSessions,
    deviceLinks,
    modSessions,
    queueEntries,
    matches,
    ratingHistory,
    auditLogs
  };
}

module.exports = {
  createJsonRepositories
};
