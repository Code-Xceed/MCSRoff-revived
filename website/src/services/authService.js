'use strict';

const crypto = require('crypto');

function createAuthService(options) {
  const {
    repositories,
    parseCookies,
    sanitizeDisplayText,
    webSessionTtlSeconds,
    accessTokenTtlSeconds,
    refreshTokenTtlSeconds
  } = options;

  function publicUser(user) {
    return {
      id: user.id,
      username: user.username,
      display_name: user.displayName,
      elo: user.elo,
      rank_tier: user.rankTier,
      status: user.status
    };
  }

  function buildSessionPayload(session, user) {
    return {
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      expires_at: Math.floor(session.accessExpiresAt / 1000),
      user: publicUser(user)
    };
  }

  function findUserById(users, userId) {
    return users.find((user) => user.id === userId) || null;
  }

  function findUserByUsername(users, username) {
    return users.find((user) => user.usernameLower === username.toLowerCase()) || null;
  }

  function findUserByDisplayName(users, displayName) {
    return users.find((user) => user.displayNameLower === displayName.toLowerCase()) || null;
  }

  async function getCurrentWebUser(request) {
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies.mcsr_web_session;
    if (!token) {
      return null;
    }
    const session = await repositories.webSessions.findActiveByToken(token, Date.now());
    if (!session) {
      return null;
    }
    const user = await repositories.users.findById(session.userId);
    if (!user || user.status !== 'active') {
      return null;
    }
    return user;
  }

  async function createWebSession(userId) {
    const session = {
      id: crypto.randomUUID(),
      userId,
      token: `web_${crypto.randomBytes(32).toString('hex')}`,
      createdAt: Date.now(),
      expiresAt: Date.now() + (webSessionTtlSeconds * 1000)
    };
    await repositories.webSessions.insert(session);
    return session;
  }

  async function getModSessionFromBearer(request) {
    const authorization = request.headers.authorization || '';
    if (!authorization.startsWith('Bearer ')) {
      return null;
    }
    const token = authorization.substring('Bearer '.length).trim();
    if (!token) {
      return null;
    }
    return repositories.modSessions.findActiveByAccessToken(token, Date.now());
  }

  async function issueModSession(userId, scope) {
    const now = Date.now();
    const session = {
      id: crypto.randomUUID(),
      userId,
      scope,
      accessToken: `acc_${crypto.randomBytes(24).toString('hex')}`,
      refreshToken: `ref_${crypto.randomBytes(32).toString('hex')}`,
      accessExpiresAt: now + (accessTokenTtlSeconds * 1000),
      refreshExpiresAt: now + (refreshTokenTtlSeconds * 1000),
      createdAt: now,
      updatedAt: now,
      revokedAt: null
    };
    return repositories.modSessions.replaceActiveForUserScope(userId, scope, session, now);
  }

  async function findModSessionById(id) {
    return repositories.modSessions.findById(id);
  }

  async function findDeviceLinkByUserCode(userCode) {
    return repositories.deviceLinks.findByUserCode(userCode);
  }

  async function getActiveDeviceLinksForUser(userId) {
    return repositories.deviceLinks.listRecentForUser(userId);
  }

  function normalizeUsername(value) {
    return sanitizeDisplayText(value, 24).replace(/\s+/g, '');
  }

  function normalizeDisplayName(value) {
    return sanitizeDisplayText(value, 24).replace(/\s+/g, '');
  }

  function normalizeUserCode(value) {
    if (typeof value !== 'string') {
      return '';
    }
    const compact = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (compact.length !== 8) {
      return value.trim().toUpperCase();
    }
    return `${compact.substring(0, 4)}-${compact.substring(4)}`;
  }

  function validateRegistration(username, displayName, password) {
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
      return 'Username must be 3-24 characters using letters, numbers, or underscores.';
    }
    if (!/^[A-Za-z0-9_]{3,24}$/.test(displayName)) {
      return 'Display name must be 3-24 characters using letters, numbers, or underscores.';
    }
    if (password.length < 8) {
      return 'Password must be at least 8 characters.';
    }
    return '';
  }

  function formatDeviceStatus(link) {
    if (link.expiresAt <= Date.now() && link.status === 'pending') {
      return 'Expired';
    }
    if (link.status === 'approved') {
      return 'Approved';
    }
    if (link.status === 'denied') {
      return 'Denied';
    }
    return 'Pending';
  }

  return {
    publicUser,
    buildSessionPayload,
    findUserById,
    findUserByUsername,
    findUserByDisplayName,
    getCurrentWebUser,
    createWebSession,
    getModSessionFromBearer,
    issueModSession,
    findModSessionById,
    findDeviceLinkByUserCode,
    getActiveDeviceLinksForUser,
    normalizeUsername,
    normalizeDisplayName,
    normalizeUserCode,
    validateRegistration,
    formatDeviceStatus
  };
}

module.exports = {
  createAuthService
};
