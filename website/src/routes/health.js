'use strict';

const { healthCheck: pgHealthCheck } = require('../db/pool');
const { healthCheck: redisHealthCheck } = require('../cache/redis');

async function healthRoutes(fastify) {
  fastify.get('/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            uptime: { type: 'number' },
            timestamp: { type: 'string' },
            services: {
              type: 'object',
              properties: {
                postgres: { type: 'boolean' },
                redis: { type: 'boolean' },
                websocket: { type: 'integer' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const [pgOk, redisOk] = await Promise.allSettled([
      pgHealthCheck(),
      redisHealthCheck()
    ]);

    const wsConnections = fastify.matchWsHub ? fastify.matchWsHub.getTotalConnections() : 0;

    const healthy = (pgOk.status === 'fulfilled' && pgOk.value) &&
                    (redisOk.status === 'fulfilled' && redisOk.value);

    reply.status(healthy ? 200 : 503).send({
      status: healthy ? 'healthy' : 'degraded',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services: {
        postgres: pgOk.status === 'fulfilled' && pgOk.value === true,
        redis: redisOk.status === 'fulfilled' && redisOk.value === true,
        websocket: wsConnections
      }
    });
  });

  fastify.get('/metrics', async (request, reply) => {
    const wsConnections = fastify.matchWsHub ? fastify.matchWsHub.getTotalConnections() : 0;
    const memUsage = process.memoryUsage();

    reply.send({
      uptime_seconds: Math.floor(process.uptime()),
      memory_rss_mb: Math.round(memUsage.rss / 1024 / 1024),
      memory_heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
      memory_heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
      websocket_connections: wsConnections,
      node_version: process.version,
      timestamp: new Date().toISOString()
    });
  });
}

module.exports = healthRoutes;
