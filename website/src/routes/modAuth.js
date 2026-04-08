'use strict';

const crypto = require('crypto');
const { hashPassword, verifyPassword, createUserCode, rankForElo } = require('../utils/auth');
const { sanitizeDisplayText } = require('../utils/web');
const { fetchFsgSeed } = require('../services/fsgService');
const { createAuditLogEntry } = require('../utils/runtimeRecords');
const config = require('../config');

async function modAuthRoutes(fastify) {
  const { repositories, authService } = fastify;

  // ── POST /mod-auth/device/start ──
  fastify.post('/device/start', {
    schema: {
      body: {
        type: 'object',
        properties: {
          minecraft_name: { type: 'string', maxLength: 32 },
          loader: { type: 'string', maxLength: 16 },
          scope: { type: 'string', maxLength: 16, default: 'matchmaker' }
        },
        required: ['minecraft_name']
      }
    },
    preHandler: [fastify.authRateLimit]
  }, async (request, reply) => {
    const { minecraft_name, loader, scope } = request.body;
    const userCode = createUserCode();
    const deviceCode = `dc_${crypto.randomBytes(24).toString('hex')}`;
    const now = Date.now();

    const link = {
      id: crypto.randomUUID(),
      deviceCode,
      userCode,
      minecraftName: sanitizeDisplayText(minecraft_name, 32),
      loader: sanitizeDisplayText(loader || 'unknown', 16),
      scope: sanitizeDisplayText(scope || 'matchmaker', 16),
      status: 'pending',
      approvedUserId: null,
      modSessionId: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + (config.DEVICE_LINK_TTL_SECONDS * 1000)
    };

    await repositories.deviceLinks.insert(link);

    return reply.send({
      device_code: deviceCode,
      user_code: userCode,
      verification_url: `${config.BASE_URL}/link`,
      expires_in: config.DEVICE_LINK_TTL_SECONDS,
      poll_interval: config.POLL_INTERVAL_SECONDS
    });
  });

  // ── POST /mod-auth/device/poll ──
  fastify.post('/device/poll', {
    schema: {
      body: {
        type: 'object',
        properties: {
          device_code: { type: 'string', maxLength: 96 }
        },
        required: ['device_code']
      }
    },
    preHandler: [fastify.authRateLimit]
  }, async (request, reply) => {
    const { device_code } = request.body;
    const link = await repositories.deviceLinks.findByDeviceCode(device_code);

    if (!link) {
      return reply.status(404).send({ error: 'not_found' });
    }
    if (link.expiresAt <= Date.now() && link.status === 'pending') {
      return reply.send({ status: 'expired' });
    }
    if (link.status === 'denied') {
      return reply.send({ status: 'denied' });
    }
    if (link.status === 'pending') {
      return reply.send({ status: 'pending' });
    }

    // Approved — issue session
    if (link.status === 'approved' && link.approvedUserId) {
      const user = await repositories.users.findById(link.approvedUserId);
      if (!user || user.status !== 'active') {
        return reply.send({ status: 'denied' });
      }

      const session = await authService.issueModSession(user.id, link.scope || 'matchmaker');

      return reply.send({
        status: 'approved',
        session: authService.buildSessionPayload(session, user)
      });
    }

    return reply.send({ status: link.status });
  });

  // ── POST /mod-auth/refresh ──
  fastify.post('/refresh', {
    schema: {
      body: {
        type: 'object',
        properties: {
          refresh_token: { type: 'string', maxLength: 128 }
        },
        required: ['refresh_token']
      }
    },
    preHandler: [fastify.authRateLimit]
  }, async (request, reply) => {
    const { refresh_token } = request.body;
    const existing = await repositories.modSessions.findByRefreshToken(refresh_token);

    if (!existing) {
      return reply.status(401).send({ error: 'invalid_refresh_token' });
    }
    if (existing.revokedAt) {
      return reply.status(401).send({ error: 'session_revoked' });
    }
    if (existing.refreshExpiresAt <= Date.now()) {
      return reply.status(401).send({ error: 'refresh_expired' });
    }

    const user = await repositories.users.findById(existing.userId);
    if (!user || user.status !== 'active') {
      return reply.status(403).send({ error: 'account_inactive' });
    }

    const session = await authService.issueModSession(user.id, existing.scope || 'matchmaker');
    return reply.send({ session: authService.buildSessionPayload(session, user) });
  });

  // ── GET /mod-auth/me ──
  fastify.get('/me', {
    preHandler: [fastify.requireModAuth]
  }, async (request, reply) => {
    return reply.send({ user: authService.publicUser(request.user) });
  });
}

module.exports = modAuthRoutes;
