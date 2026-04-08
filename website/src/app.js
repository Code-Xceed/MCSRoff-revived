'use strict';

const path = require('path');
const fastify = require('fastify');

function buildApp(opts = {}) {
  const app = fastify({
    logger: opts.logger !== false ? {
      level: process.env.LOG_LEVEL || 'info',
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined
    } : false,
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    ajv: {
      customOptions: {
        removeAdditional: 'all',
        coerceTypes: true,
        useDefaults: true
      }
    },
    bodyLimit: 1048576 // 1MB
  });

  // ── Core Plugins ──
  app.register(require('@fastify/cors'), {
    origin: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id']
  });

  app.register(require('@fastify/helmet'), {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'wss:', 'ws:']
      }
    },
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false
  });

  app.register(require('@fastify/cookie'));
  app.register(require('@fastify/formbody'));

  app.register(require('@fastify/static'), {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/static/',
    decorateReply: false
  });

  app.register(require('@fastify/websocket'), {
    options: {
      maxPayload: 65536,
      clientTracking: true
    }
  });

  // ── Custom Plugins ──
  app.register(require('./plugins/rateLimitPlugin'));
  app.register(require('./plugins/authPlugin'));
  app.register(require('./plugins/servicesPlugin'));

  // ── Routes ──
  app.register(require('./routes/health'));
  app.register(require('./routes/modAuth'), { prefix: '/mod-auth' });
  app.register(require('./routes/matchmaker'));
  app.register(require('./routes/web'));
  app.register(require('./routes/admin'), { prefix: '/admin' });

  // ── Global Error Handler ──
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Internal Server Error');
    } else {
      request.log.warn({ err: error }, 'Client Error');
    }
    reply.status(statusCode).send({
      error: error.message || 'Internal Server Error',
      statusCode
    });
  });

  // ── Not Found Handler ──
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({ error: 'Not Found', statusCode: 404 });
  });

  // ── Graceful Shutdown ──
  const shutdown = async () => {
    app.log.info('Graceful shutdown initiated');
    try {
      const { closePool } = require('./db/pool');
      const { closeRedis } = require('./cache/redis');
      await Promise.allSettled([closePool(), closeRedis()]);
    } catch { /* ignore */ }
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return app;
}

module.exports = { buildApp };
