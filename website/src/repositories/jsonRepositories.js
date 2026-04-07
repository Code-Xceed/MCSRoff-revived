'use strict';

function createJsonRepositories(store) {
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
        rows[index] = match;
        store.saveTable('matches', rows);
      }
      return match;
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
