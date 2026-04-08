'use strict';

const fp = require('fastify-plugin');
const { getCachedSession, setCachedSession } = require('../cache/sessionCache');

async function authPlugin(fastify) {
  // Decorate request with user and modSession
  fastify.decorateRequest('modSession', null);
  fastify.decorateRequest('user', null);

  /**
   * Resolve mod session from Bearer token.
   * Checks Redis cache first, falls back to DB.
   */
  async function resolveModSession(request) {
    const auth = request.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return null;
    const token = auth.substring(7).trim();
    if (!token) return null;

    // Check cache
    const cached = await getCachedSession(token);
    if (cached) return cached;

    // Fall back to DB
    const repos = fastify.repositories;
    const session = await repos.modSessions.findActiveByAccessToken(token, Date.now());
    if (session) {
      await setCachedSession(token, session);
    }
    return session;
  }

  /**
   * Resolve web user from cookie.
   */
  async function resolveWebUser(request) {
    const token = request.cookies && request.cookies.mcsr_web_session;
    if (!token) return null;
    const repos = fastify.repositories;
    const session = await repos.webSessions.findActiveByToken(token, Date.now());
    if (!session) return null;
    const user = await repos.users.findById(session.userId);
    return user && user.status === 'active' ? user : null;
  }

  // Pre-handler that requires a valid mod session
  fastify.decorate('requireModAuth', async (request, reply) => {
    const session = await resolveModSession(request);
    if (!session) {
      reply.status(401).send({ error: 'Unauthorized' });
      throw new Error('unauthorized');
    }

    const repos = fastify.repositories;
    const user = await repos.users.findById(session.userId);
    if (!user || user.status !== 'active') {
      reply.status(403).send({ error: 'Account inactive' });
      throw new Error('forbidden');
    }

    request.modSession = session;
    request.user = user;
  });

  // Pre-handler that requires a valid web session
  fastify.decorate('requireWebAuth', async (request, reply) => {
    const user = await resolveWebUser(request);
    if (!user) {
      reply.status(401).send({ error: 'Unauthorized' });
      throw new Error('unauthorized');
    }
    request.user = user;
  });

  // Optional — resolve web user but don't require it
  fastify.decorate('optionalWebAuth', async (request) => {
    request.user = await resolveWebUser(request);
  });

  // Expose resolver for flexible use
  fastify.decorate('resolveModSession', resolveModSession);
  fastify.decorate('resolveWebUser', resolveWebUser);
}

module.exports = fp(authPlugin, { name: 'auth-plugin', dependencies: ['rate-limit-plugin'] });
