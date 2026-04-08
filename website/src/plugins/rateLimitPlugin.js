'use strict';

const fp = require('fastify-plugin');
const { getRedis } = require('../cache/redis');

async function rateLimitPlugin(fastify) {
  const limits = {
    auth:  { max: Number(process.env.AUTH_RATE_LIMIT_MAX || 40),  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 60000) },
    match: { max: Number(process.env.MATCH_RATE_LIMIT_MAX || 600), windowMs: Number(process.env.MATCH_RATE_LIMIT_WINDOW_MS || 60000) },
    page:  { max: Number(process.env.PAGE_RATE_LIMIT_MAX || 120),  windowMs: Number(process.env.PAGE_RATE_LIMIT_WINDOW_MS || 60000) }
  };

  async function checkRateLimit(request, reply, category) {
    const config = limits[category] || limits.page;
    const ip = request.ip || '0.0.0.0';
    const key = `rl:${category}:${ip}`;
    const redis = getRedis();
    const windowSec = Math.ceil(config.windowMs / 1000);

    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSec);
    }

    const ttl = await redis.ttl(key);
    const remaining = Math.max(0, config.max - count);

    reply.header('X-RateLimit-Limit', String(config.max));
    reply.header('X-RateLimit-Remaining', String(remaining));
    reply.header('X-RateLimit-Reset', String(Math.ceil(Date.now() / 1000) + Math.max(ttl, 1)));

    if (count > config.max) {
      reply.header('Retry-After', String(Math.max(ttl, 1)));
      reply.status(429).send({ error: 'Too Many Requests', retryAfter: Math.max(ttl, 1) });
      return false;
    }
    return true;
  }

  fastify.decorate('checkRateLimit', checkRateLimit);

  fastify.decorate('authRateLimit', async (request, reply) => {
    const ok = await checkRateLimit(request, reply, 'auth');
    if (!ok) throw new Error('rate_limited');
  });

  fastify.decorate('matchRateLimit', async (request, reply) => {
    const ok = await checkRateLimit(request, reply, 'match');
    if (!ok) throw new Error('rate_limited');
  });

  fastify.decorate('pageRateLimit', async (request, reply) => {
    const ok = await checkRateLimit(request, reply, 'page');
    if (!ok) throw new Error('rate_limited');
  });
}

module.exports = fp(rateLimitPlugin, { name: 'rate-limit-plugin' });
