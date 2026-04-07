'use strict';

const crypto = require('crypto');
const { createAuditLogEntry } = require('../utils/runtimeRecords');

function createAuthApiController(options) {
  const {
    baseUrl,
    deviceLinkTtlSeconds,
    pollIntervalSeconds,
    accessTokenTtlSeconds,
    refreshTokenTtlSeconds,
    repositories,
    sendJson,
    readBody,
    sanitizeDisplayText,
    createUserCode,
    publicUser,
    buildSessionPayload,
    getCurrentWebUser,
    getModSessionFromBearer,
    issueModSession,
    findModSessionById
  } = options;

  async function handleSessionApi(request, response) {
    const user = await getCurrentWebUser(request);
    if (!user) {
      return sendJson(response, 401, { authenticated: false });
    }
    sendJson(response, 200, {
      authenticated: true,
      user: publicUser(user)
    });
  }

  async function handleDeviceStart(request, response) {
    const body = await readBody(request);
    const minecraftName = sanitizeDisplayText(body.minecraft_name, 24) || 'Runner';
    const loader = sanitizeDisplayText(body.loader, 16) || 'unknown';
    const scope = sanitizeDisplayText(body.scope, 32) || 'mcsr_mod';

    const link = {
      id: crypto.randomUUID(),
      deviceCode: `dev_${crypto.randomBytes(18).toString('hex')}`,
      userCode: createUserCode(await repositories.deviceLinks.getAll()),
      minecraftName,
      loader,
      scope,
      status: 'pending',
      approvedUserId: null,
      modSessionId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + (deviceLinkTtlSeconds * 1000)
    };
    await repositories.deviceLinks.insert(link);
    await repositories.auditLogs.insert(createAuditLogEntry(
      null,
      'auth',
      'device_start',
      'device_link',
      link.id,
      '',
      {
        minecraft_name: link.minecraftName,
        loader: link.loader,
        scope: link.scope
      },
      link.createdAt
    ));

    sendJson(response, 200, {
      device_code: link.deviceCode,
      user_code: link.userCode,
      verification_uri: `${baseUrl}/link`,
      verification_uri_complete: `${baseUrl}/link?code=${encodeURIComponent(link.userCode)}`,
      expires_in: deviceLinkTtlSeconds,
      interval: pollIntervalSeconds
    });
  }

  async function handleDevicePoll(request, response) {
    const body = await readBody(request);
    const deviceCode = typeof body.device_code === 'string' ? body.device_code.trim() : '';
    if (!deviceCode) {
      return sendJson(response, 400, { error: 'device_code is required' });
    }

    const deviceLink = await repositories.deviceLinks.findByDeviceCode(deviceCode);
    if (!deviceLink) {
      return sendJson(response, 404, { status: 'expired' });
    }
    if (deviceLink.expiresAt <= Date.now() && deviceLink.status === 'pending') {
      deviceLink.status = 'expired';
      await repositories.deviceLinks.update(deviceLink);
      return sendJson(response, 200, { status: 'expired' });
    }
    if (deviceLink.status === 'pending') {
      return sendJson(response, 200, { status: 'pending' });
    }
    if (deviceLink.status === 'denied') {
      return sendJson(response, 200, { status: 'denied' });
    }
    if (deviceLink.status !== 'approved' || !deviceLink.approvedUserId) {
      return sendJson(response, 200, { status: 'expired' });
    }

    const user = await repositories.users.findById(deviceLink.approvedUserId);
    if (!user || user.status !== 'active') {
      return sendJson(response, 403, { status: 'denied' });
    }

    let modSession = deviceLink.modSessionId ? await findModSessionById(deviceLink.modSessionId) : null;
    if (!modSession || modSession.refreshExpiresAt <= Date.now() || modSession.accessExpiresAt <= Date.now()) {
      modSession = await issueModSession(user.id, deviceLink.scope);
      deviceLink.modSessionId = modSession.id;
      deviceLink.updatedAt = Date.now();
      await repositories.deviceLinks.update(deviceLink);
      await repositories.auditLogs.insert(createAuditLogEntry(
        user.id,
        'auth',
        'device_link_issued_session',
        'device_link',
        deviceLink.id,
        '',
        {
          scope: deviceLink.scope,
          mod_session_id: modSession.id
        },
        deviceLink.updatedAt
      ));
    }

    sendJson(response, 200, {
      status: 'approved',
      session: buildSessionPayload(modSession, user)
    });
  }

  async function handleRefresh(request, response) {
    const body = await readBody(request);
    const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token.trim() : '';
    if (!refreshToken) {
      return sendJson(response, 400, { error: 'refresh_token is required' });
    }

    const session = await repositories.modSessions.findByRefreshToken(refreshToken);
    if (!session) {
      return sendJson(response, 401, { error: 'Invalid refresh token' });
    }
    if (session.revokedAt || session.refreshExpiresAt <= Date.now()) {
      return sendJson(response, 401, { error: 'Refresh token expired' });
    }

    session.accessToken = `acc_${crypto.randomBytes(24).toString('hex')}`;
    session.refreshToken = `ref_${crypto.randomBytes(32).toString('hex')}`;
    session.accessExpiresAt = Date.now() + (accessTokenTtlSeconds * 1000);
    session.refreshExpiresAt = Date.now() + (refreshTokenTtlSeconds * 1000);
    session.updatedAt = Date.now();
    await repositories.modSessions.update(session);

    const user = await repositories.users.findById(session.userId);
    if (!user || user.status !== 'active') {
      return sendJson(response, 403, { error: 'Account inactive' });
    }

    await repositories.auditLogs.insert(createAuditLogEntry(
      user.id,
      'auth',
      'refresh_session',
      'mod_session',
      session.id,
      '',
      {
        scope: session.scope
      },
      session.updatedAt
    ));

    sendJson(response, 200, buildSessionPayload(session, user));
  }

  async function handleMe(request, response) {
    const modSession = await getModSessionFromBearer(request);
    if (!modSession) {
      return sendJson(response, 401, { error: 'Unauthorized' });
    }

    const user = await repositories.users.findById(modSession.userId);
    if (!user || user.status !== 'active') {
      return sendJson(response, 403, { error: 'Account inactive' });
    }

    sendJson(response, 200, publicUser(user));
  }

  return {
    handleSessionApi,
    handleDeviceStart,
    handleDevicePoll,
    handleRefresh,
    handleMe
  };
}

module.exports = {
  createAuthApiController
};
