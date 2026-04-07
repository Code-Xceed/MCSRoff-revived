'use strict';

const { createAuditLogEntry } = require('../utils/runtimeRecords');

function createAccountService(options) {
  const {
    repositories,
    adminUsernames,
    rankForElo
  } = options;

  const adminSet = new Set((adminUsernames || []).map((value) => String(value || '').toLowerCase()).filter(Boolean));

  function isAdminUser(user) {
    return !!(user && user.username && adminSet.has(String(user.username).toLowerCase()));
  }

  async function revokeUserSessions(userId, actorUserId, reason) {
    const now = Date.now();
    await Promise.all([
      repositories.webSessions.deleteByUserId(userId),
      repositories.modSessions.revokeByUserId(userId, now)
    ]);
    await repositories.auditLogs.insert(createAuditLogEntry(
      actorUserId || userId,
      'security',
      actorUserId && actorUserId !== userId ? 'admin_revoke_sessions' : 'revoke_sessions',
      'user',
      userId,
      '',
      {
        reason: reason || ''
      },
      now
    ));
    return now;
  }

  async function updateUserStatus(userId, nextStatus, actorUserId, reason) {
    const user = await repositories.users.findById(userId);
    if (!user) {
      return null;
    }
    const normalizedStatus = String(nextStatus || '').toLowerCase();
    if (!['active', 'disabled', 'banned'].includes(normalizedStatus)) {
      throw new Error('Invalid account status.');
    }
    if (user.status === normalizedStatus) {
      return user;
    }
    user.status = normalizedStatus;
    user.updatedAt = Date.now();
    user.rankTier = rankForElo(user.elo);
    const updatedUser = await repositories.users.update(user);
    if (normalizedStatus !== 'active') {
      await revokeUserSessions(user.id, actorUserId || user.id, `status:${normalizedStatus}`);
    }
    await repositories.auditLogs.insert(createAuditLogEntry(
      actorUserId || user.id,
      'admin',
      'set_account_status',
      'user',
      user.id,
      '',
      {
        status: normalizedStatus,
        reason: reason || ''
      },
      Date.now()
    ));
    return updatedUser;
  }

  async function listRecentUsers(limit) {
    const users = await repositories.users.listRecent(limit);
    const now = Date.now();
    const decorated = await Promise.all(users.map(async (user) => {
      const activeSessions = await repositories.modSessions.listActiveByUserId(user.id, now);
      return {
        user,
        activeModSessionCount: activeSessions.length
      };
    }));
    return decorated;
  }

  async function getSecuritySnapshot(userId) {
    const now = Date.now();
    const activeModSessions = await repositories.modSessions.listActiveByUserId(userId, now);
    return {
      activeModSessions
    };
  }

  return {
    isAdminUser,
    revokeUserSessions,
    updateUserStatus,
    listRecentUsers,
    getSecuritySnapshot
  };
}

module.exports = {
  createAccountService
};
