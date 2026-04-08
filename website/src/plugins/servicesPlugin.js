'use strict';

const fp = require('fastify-plugin');
const { createRepositories } = require('../repositories/createRepositories');
const { createJsonStore } = require('../storage/jsonStore');
const { createAuthService } = require('../services/authService');
const { createAccountService } = require('../services/accountService');
const { createMatchService } = require('../services/matchService');
const { createMatchWebSocketHub } = require('../services/matchWebSocketHub');
const { sanitizeDisplayText, parseCookies } = require('../utils/web');
const { rankForElo } = require('../utils/auth');
const { calculateHeadToHeadRatings } = require('../utils/rating');
const config = require('../config');

async function servicesPlugin(fastify) {
  // ── Repositories ──
  const storage = createJsonStore(config.DATA_DIR, config.TABLES);
  const repositories = createRepositories({
    backend: config.STORAGE_BACKEND,
    store: storage
  });
  fastify.decorate('repositories', repositories);

  // ── WebSocket Hub ──
  const matchWsHub = createMatchWebSocketHub();
  fastify.decorate('matchWsHub', matchWsHub);

  // ── Auth Service ──
  const authService = createAuthService({
    repositories,
    parseCookies,
    sanitizeDisplayText,
    webSessionTtlSeconds: config.WEB_SESSION_TTL_SECONDS,
    accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS
  });
  fastify.decorate('authService', authService);

  // ── Account Service ──
  const accountService = createAccountService({
    repositories,
    adminUsernames: config.ADMIN_USERNAMES,
    rankForElo
  });
  fastify.decorate('accountService', accountService);

  // ── Match Service ──
  const matchService = createMatchService({
    repositories,
    sanitizeDisplayText,
    rankForElo,
    calculateHeadToHeadRatings,
    matchPlayerStaleMillis: config.MATCH_PLAYER_STALE_MILLIS,
    matchPrestartStaleMillis: config.MATCH_PRESTART_STALE_MILLIS,
    matchWorldLoadingStaleMillis: config.MATCH_WORLD_LOADING_STALE_MILLIS,
    matchRunningStaleMillis: config.MATCH_RUNNING_STALE_MILLIS
  });
  fastify.decorate('matchService', matchService);

  // ── Cleanup on close ──
  fastify.addHook('onClose', async () => {
    matchWsHub.closeAll();
  });
}

module.exports = fp(servicesPlugin, {
  name: 'services-plugin',
  dependencies: ['auth-plugin']
});
