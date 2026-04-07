'use strict';

require('./src/utils/loadEnv').initializeRuntimeEnv();

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const {
  PORT,
  HOST,
  BASE_URL,
  STORAGE_BACKEND,
  DATA_DIR,
  PUBLIC_DIR,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  WEB_SESSION_TTL_SECONDS,
  DEVICE_LINK_TTL_SECONDS,
  POLL_INTERVAL_SECONDS,
  MATCH_PLAYER_STALE_MILLIS,
  MATCH_PRESTART_STALE_MILLIS,
  MATCH_RUNNING_STALE_MILLIS,
  AUTH_RATE_LIMIT_WINDOW_MS,
  AUTH_RATE_LIMIT_MAX,
  MATCH_RATE_LIMIT_WINDOW_MS,
  MATCH_RATE_LIMIT_MAX,
  PAGE_RATE_LIMIT_WINDOW_MS,
  PAGE_RATE_LIMIT_MAX,
  ADMIN_USERNAMES,
  TABLES
} = require('./src/config');
const { createJsonStore } = require('./src/storage/jsonStore');
const { createRepositories } = require('./src/repositories/createRepositories');
const { serveStatic, readBody, sendJson, sendHtml, sendPlain, redirect } = require('./src/utils/http');
const { rankForElo, hashPassword, verifyPassword, createUserCode } = require('./src/utils/auth');
const { calculateHeadToHeadRatings } = require('./src/utils/rating');
const { createAuditLogEntry } = require('./src/utils/runtimeRecords');
const { safeNext, sanitizeDisplayText, parseCookies, setCookie, clearCookie, escapeHtml } = require('./src/utils/web');
const { fetchFsgSeed } = require('./src/services/fsgService');
const { createAuthService } = require('./src/services/authService');
const { createAccountService } = require('./src/services/accountService');
const { createMatchService } = require('./src/services/matchService');
const { createAuthApiController } = require('./src/controllers/authApiController');
const { createMatchmakingController } = require('./src/controllers/matchmakingController');
const { createMatchStreamHub } = require('./src/services/matchStreamHub');
const { createRequestContext } = require('./src/utils/requestContext');
const { logInfo, logWarn, logError } = require('./src/utils/logger');
const { createRateLimiter } = require('./src/services/rateLimiter');

const storage = createJsonStore(DATA_DIR, TABLES);
const repositories = createRepositories({
  backend: STORAGE_BACKEND,
  store: storage
});
const matchStreamHub = createMatchStreamHub();
const rateLimiter = createRateLimiter();
const authService = createAuthService({
  repositories,
  parseCookies,
  sanitizeDisplayText,
  webSessionTtlSeconds: WEB_SESSION_TTL_SECONDS,
  accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTtlSeconds: REFRESH_TOKEN_TTL_SECONDS
});
const {
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
} = authService;
const accountService = createAccountService({
  repositories,
  adminUsernames: ADMIN_USERNAMES,
  rankForElo
});
const {
  isAdminUser,
  revokeUserSessions,
  updateUserStatus,
  listRecentUsers,
  getSecuritySnapshot
} = accountService;
const matchService = createMatchService({
  repositories,
  sanitizeDisplayText,
  rankForElo,
  calculateHeadToHeadRatings,
  matchPlayerStaleMillis: MATCH_PLAYER_STALE_MILLIS,
  matchPrestartStaleMillis: MATCH_PRESTART_STALE_MILLIS,
  matchRunningStaleMillis: MATCH_RUNNING_STALE_MILLIS
});
const {
  findCompatibleQueueEntry,
  sanitizeFilterIds,
  normalizeSeedMode,
  createMatchFromQueue,
  appendMatch,
  findMatchById,
  findActiveMatchForUser,
  findMatchPlayer,
  requireOwnedMatch,
  persistMatchState,
  cleanupMatchmakerState,
  buildSnapshotResponse,
  abandonActiveMatchesForUser,
  touchMatchPlayer,
  heartbeatMatch,
  reportMatchFinish,
  reportMatchForfeit
} = matchService;
const authApiController = createAuthApiController({
  baseUrl: BASE_URL,
  deviceLinkTtlSeconds: DEVICE_LINK_TTL_SECONDS,
  pollIntervalSeconds: POLL_INTERVAL_SECONDS,
  accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTtlSeconds: REFRESH_TOKEN_TTL_SECONDS,
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
});
const matchmakingController = createMatchmakingController({
  repositories,
  sendJson,
  readBody,
  sanitizeDisplayText,
  matchStreamHub,
  fetchFsgSeed,
  getModSessionFromBearer,
  cleanupMatchmakerState,
  normalizeSeedMode,
  sanitizeFilterIds,
  findCompatibleQueueEntry,
  createMatchFromQueue,
  appendMatch,
  buildSnapshotResponse,
  findMatchById,
  findActiveMatchForUser,
  findMatchPlayer,
  requireOwnedMatch,
  touchMatchPlayer,
  persistMatchState,
  abandonActiveMatchesForUser,
  heartbeatMatch,
  reportMatchFinish,
  reportMatchForfeit
});

if (STORAGE_BACKEND === 'json') {
  storage.ensureStorage();
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, BASE_URL);
  const requestContext = createRequestContext(request, response);

  response.on('finish', () => {
    logInfo('request_completed', {
      request_id: requestContext.id,
      method: requestContext.method,
      path: requestUrl.pathname,
      status_code: response.statusCode,
      duration_ms: Date.now() - requestContext.startedAt,
      ip: requestContext.ip
    });
  });

  try {
    rateLimiter.prune(Date.now());
    if (!applyRouteRateLimit(request, response, requestUrl)) {
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/styles.css') {
      return serveStatic(response, `${PUBLIC_DIR}/styles.css`, 'text/css; charset=utf-8');
    }
    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      return sendJson(response, 200, {
        ok: true,
        service: 'mcsroff-auth-site',
        storage_backend: STORAGE_BACKEND,
        request_id: requestContext.id
      });
    }
    if (request.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/dashboard')) {
      return handleDashboard(request, response, requestUrl);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/dashboard/revoke-mod-sessions') {
      return handleSelfSessionRevoke(request, response);
    }
    if (request.method === 'GET' && requestUrl.pathname === '/register') {
      return handleRegisterPage(request, response, requestUrl, null);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/register') {
      return handleRegister(request, response);
    }
    if (request.method === 'GET' && requestUrl.pathname === '/login') {
      return handleLoginPage(request, response, requestUrl, null);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/login') {
      return handleLogin(request, response);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/logout') {
      return handleLogout(request, response);
    }
    if (request.method === 'GET' && requestUrl.pathname === '/link') {
      return handleLinkPage(request, response, requestUrl, null);
    }
    if (request.method === 'GET' && requestUrl.pathname === '/admin') {
      return handleAdminPage(request, response, requestUrl, null);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/admin/users/status') {
      return handleAdminStatusUpdate(request, response);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/admin/users/revoke-sessions') {
      return handleAdminSessionRevoke(request, response);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/link/approve') {
      return handleLinkDecision(request, response, true);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/link/deny') {
      return handleLinkDecision(request, response, false);
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/session') {
      return authApiController.handleSessionApi(request, response);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/mod-auth/device/start') {
      return authApiController.handleDeviceStart(request, response);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/mod-auth/device/poll') {
      return authApiController.handleDevicePoll(request, response);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/mod-auth/refresh') {
      return authApiController.handleRefresh(request, response);
    }
    if (request.method === 'GET' && requestUrl.pathname === '/mod-auth/me') {
      return authApiController.handleMe(request, response);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/matchmaker') {
      return matchmakingController.handleMatchmaker(request, response);
    }
    if (request.method === 'GET' && requestUrl.pathname === '/mod-stream/match') {
      return matchmakingController.handleMatchStream(request, response);
    }

    sendHtml(response, 404, renderPage('Not Found', `
      <section class="card">
        <h1>Page not found</h1>
        <p class="helper">The route you requested does not exist.</p>
        <p class="helper">Request ID: <code>${escapeHtml(requestContext.id)}</code></p>
        <p><a class="button secondary" href="/">Return home</a></p>
      </section>
    `));
  } catch (error) {
    logError('request_failed', {
      request_id: requestContext.id,
      method: requestContext.method,
      path: requestUrl.pathname,
      ip: requestContext.ip,
      error_message: error && error.message ? error.message : 'Unknown error',
      error_stack: error && error.stack ? error.stack : ''
    });
    sendHtml(response, 500, renderPage('Server Error', `
      <section class="card">
        <h1>Server error</h1>
        <p class="helper">${escapeHtml(error.message || 'Unexpected failure')}</p>
        <p class="helper">Request ID: <code>${escapeHtml(requestContext.id)}</code></p>
      </section>
    `));
  }
});

server.listen(PORT, HOST, () => {
  logInfo('server_listening', {
    base_url: BASE_URL,
    host: HOST,
    port: PORT,
    storage_backend: STORAGE_BACKEND
  });
});

function applyRouteRateLimit(request, response, requestUrl) {
  const rule = resolveRateLimitRule(request.method, requestUrl.pathname);
  if (!rule) {
    return true;
  }
  const bucketKey = `${rule.bucket}:${request.context.ip}`;
  const result = rateLimiter.evaluate(bucketKey, rule.limit, rule.windowMs, Date.now());
  rateLimiter.applyHeaders(response, result);
  if (result.allowed) {
    return true;
  }
  logWarn('rate_limit_exceeded', {
    request_id: request.context.id,
    method: request.method || 'GET',
    path: requestUrl.pathname,
    ip: request.context.ip,
    bucket: rule.bucket,
    limit: rule.limit,
    window_ms: rule.windowMs
  });
  sendJson(response, 429, {
    error: 'rate_limited',
    request_id: request.context.id
  });
  return false;
}

function resolveRateLimitRule(method, pathName) {
  if (method === 'POST' && (pathName === '/register' || pathName === '/login' || pathName === '/logout')) {
    return {
      bucket: `auth-page:${pathName}`,
      limit: AUTH_RATE_LIMIT_MAX,
      windowMs: AUTH_RATE_LIMIT_WINDOW_MS
    };
  }
  if (method === 'POST' && (pathName === '/dashboard/revoke-mod-sessions' || pathName === '/admin/users/status' || pathName === '/admin/users/revoke-sessions')) {
    return {
      bucket: `security:${pathName}`,
      limit: AUTH_RATE_LIMIT_MAX,
      windowMs: AUTH_RATE_LIMIT_WINDOW_MS
    };
  }
  if ((pathName === '/mod-auth/device/start' || pathName === '/mod-auth/device/poll' || pathName === '/mod-auth/refresh') && method === 'POST') {
    return {
      bucket: `mod-auth:${pathName}`,
      limit: AUTH_RATE_LIMIT_MAX * 3,
      windowMs: AUTH_RATE_LIMIT_WINDOW_MS
    };
  }
  if (pathName === '/mod-auth/me' && method === 'GET') {
    return {
      bucket: 'mod-auth:me',
      limit: AUTH_RATE_LIMIT_MAX * 4,
      windowMs: AUTH_RATE_LIMIT_WINDOW_MS
    };
  }
  if (pathName === '/matchmaker' && method === 'POST') {
    return {
      bucket: 'match-api',
      limit: MATCH_RATE_LIMIT_MAX,
      windowMs: MATCH_RATE_LIMIT_WINDOW_MS
    };
  }
  if (pathName === '/mod-stream/match' && method === 'GET') {
    return {
      bucket: 'match-stream',
      limit: MATCH_RATE_LIMIT_MAX,
      windowMs: MATCH_RATE_LIMIT_WINDOW_MS
    };
  }
  if (method === 'GET' && (pathName === '/' || pathName === '/dashboard' || pathName === '/register' || pathName === '/login' || pathName === '/link' || pathName === '/admin' || pathName === '/health')) {
    return {
      bucket: `page:${pathName}`,
      limit: PAGE_RATE_LIMIT_MAX,
      windowMs: PAGE_RATE_LIMIT_WINDOW_MS
    };
  }
  return null;
}

async function handleDashboard(request, response, requestUrl) {
  const user = await getCurrentWebUser(request);
  if (!user) {
    sendHtml(response, 200, renderPage('MCSR Auth', `
      <section class="card hero">
        <span class="pill">Trusted Identity</span>
        <h1>MCSR Mod Authentication</h1>
        <p>This site owns competitive identity for the mod. Players create one account with a unique username and display name, then link the mod through a short device code. The mod never self-asserts rank, Elo, or account ownership.</p>
        <div class="inline-actions">
          <a class="button" href="/register">Create Account</a>
          <a class="button secondary" href="/login">Sign In</a>
        </div>
      </section>
      <section class="grid two">
        <article class="card">
          <h2>How linking works</h2>
          <p class="helper">Open the mod, click the boots button, then follow the account link flow. The mod will show a device code and open this website. Once approved here, the mod receives a revocable access session.</p>
        </article>
        <article class="card">
          <h2>What is unique</h2>
          <div class="stats">
            <div class="stat-row"><span>Username</span><strong>Unique and permanent</strong></div>
            <div class="stat-row"><span>Display name</span><strong>Unique and shown in queue</strong></div>
            <div class="stat-row"><span>Rank / Elo</span><strong>Owned by the website account</strong></div>
          </div>
        </article>
      </section>
    `, { currentPath: requestUrl.pathname }));
    return;
  }

  const pendingLinks = await getActiveDeviceLinksForUser(user.id);
  const security = await getSecuritySnapshot(user.id);
  sendHtml(response, 200, renderPage('Dashboard', `
    <section class="grid two">
      <article class="card">
        <h1>Account Dashboard</h1>
        <div class="stats">
          <div class="stat-row"><span>Username</span><strong>${escapeHtml(user.username)}</strong></div>
          <div class="stat-row"><span>Display name</span><strong>${escapeHtml(user.displayName)}</strong></div>
          <div class="stat-row"><span>User ID</span><strong>${escapeHtml(user.id)}</strong></div>
          <div class="stat-row"><span>Rank</span><strong>${escapeHtml(user.rankTier)}</strong></div>
          <div class="stat-row"><span>Elo</span><strong>${user.elo}</strong></div>
        </div>
      </article>
      <article class="card">
        <h2>Connect the mod</h2>
        <p class="helper">In the mod, choose <strong>Link Account</strong>. If a device code is active, open the link page or paste the code here.</p>
        <form class="form-grid" method="GET" action="/link">
          <div>
            <label for="code">Device Code</label>
            <input id="code" name="code" type="text" placeholder="ABCD-1234" />
          </div>
          <input type="submit" value="Open Link Approval" />
        </form>
      </article>
    </section>
    <section class="grid two">
      <article class="card">
        <h2>Account Security</h2>
        <div class="stats">
          <div class="stat-row"><span>Active mod sessions</span><strong>${security.activeModSessions.length}</strong></div>
          <div class="stat-row"><span>Website status</span><strong>${escapeHtml(user.status)}</strong></div>
        </div>
        <form method="POST" action="/dashboard/revoke-mod-sessions">
          <button class="danger" type="submit">Revoke All Mod Sessions</button>
        </form>
        <p class="helper">This signs the mod out on every linked client for this account. The website session you are using right now stays available.</p>
      </article>
      <article class="card">
        <h2>Operations</h2>
        <div class="stats">
          <div class="stat-row"><span>Admin access</span><strong>${isAdminUser(user) ? 'Enabled' : 'No'}</strong></div>
          <div class="stat-row"><span>Backend storage</span><strong>${escapeHtml(STORAGE_BACKEND)}</strong></div>
        </div>
        ${isAdminUser(user) ? `
          <div class="inline-actions">
            <a class="button secondary" href="/admin">Open Admin Panel</a>
          </div>
        ` : `
          <p class="helper">Admin tools are available only for configured operator accounts.</p>
        `}
      </article>
    </section>
    <section class="card">
      <h2>Recent active link requests</h2>
      ${pendingLinks.length === 0 ? `
        <p class="helper">No pending or recently approved mod device links yet.</p>
      ` : `
        <div class="stats">
          ${pendingLinks.map((link) => `
            <div class="stat-row">
              <span>${escapeHtml(link.userCode)} | ${escapeHtml(link.minecraftName)} | ${escapeHtml(link.loader)}</span>
              <strong>${escapeHtml(formatDeviceStatus(link))}</strong>
            </div>
          `).join('')}
        </div>
      `}
      <p class="footer-note">Runtime storage backend: <code>${escapeHtml(STORAGE_BACKEND)}</code>.</p>
    </section>
  `, { user, currentPath: requestUrl.pathname }));
}

async function handleSelfSessionRevoke(request, response) {
  const user = await getCurrentWebUser(request);
  if (!user) {
    redirect(response, '/login?next=%2Fdashboard');
    return;
  }
  await revokeUserSessions(user.id, user.id, 'self_service_dashboard');
  redirect(response, '/dashboard');
}

async function handleRegisterPage(request, response, requestUrl, errorMessage) {
  const next = safeNext(requestUrl.searchParams.get('next'));
  sendHtml(response, 200, renderPage('Create Account', `
    <section class="card">
      <h1>Create Account</h1>
      ${renderFlash(errorMessage, 'error')}
      <form class="form-grid" method="POST" action="/register">
        <input type="hidden" name="next" value="${escapeHtml(next)}" />
        <div>
          <label for="username">Unique Username</label>
          <input id="username" name="username" type="text" maxlength="24" required />
        </div>
        <div>
          <label for="display_name">Unique Display Name</label>
          <input id="display_name" name="display_name" type="text" maxlength="24" required />
        </div>
        <div>
          <label for="password">Password</label>
          <input id="password" name="password" type="password" minlength="8" required />
        </div>
        <input type="submit" value="Create Account" />
      </form>
      <p class="helper">Already have an account? <a href="/login${next ? `?next=${encodeURIComponent(next)}` : ''}">Sign in</a>.</p>
    </section>
  `, { currentPath: requestUrl.pathname }));
}

async function handleRegister(request, response) {
  const body = await readBody(request);
  const username = normalizeUsername(body.username);
  const displayName = normalizeDisplayName(body.display_name);
  const password = typeof body.password === 'string' ? body.password : '';
  const next = safeNext(body.next);

  const validationError = validateRegistration(username, displayName, password);
  if (validationError) {
    return handleRegisterPage(request, response, new URL(`/register?next=${encodeURIComponent(next)}`, BASE_URL), validationError);
  }

  if (await repositories.users.findByUsernameLower(username.toLowerCase())) {
    return handleRegisterPage(request, response, new URL(`/register?next=${encodeURIComponent(next)}`, BASE_URL), 'That username is already taken.');
  }
  if (await repositories.users.findByDisplayNameLower(displayName.toLowerCase())) {
    return handleRegisterPage(request, response, new URL(`/register?next=${encodeURIComponent(next)}`, BASE_URL), 'That display name is already taken.');
  }

  const passwordMaterial = hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    username,
    usernameLower: username.toLowerCase(),
    displayName,
    displayNameLower: displayName.toLowerCase(),
    passwordHash: passwordMaterial.hash,
    passwordSalt: passwordMaterial.salt,
    elo: 1200,
    rankTier: rankForElo(1200),
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await repositories.users.insert(user);
  await repositories.auditLogs.insert(createAuditLogEntry(
    user.id,
    'auth',
    'register_account',
    'user',
    user.id,
    '',
    {
      username: user.username,
      display_name: user.displayName
    },
    user.createdAt
  ));

  const session = await createWebSession(user.id);
  setCookie(response, 'mcsr_web_session', session.token, WEB_SESSION_TTL_SECONDS);
  redirect(response, next || '/dashboard');
}

async function handleLoginPage(request, response, requestUrl, errorMessage) {
  const next = safeNext(requestUrl.searchParams.get('next'));
  sendHtml(response, 200, renderPage('Sign In', `
    <section class="card">
      <h1>Sign In</h1>
      ${renderFlash(errorMessage, 'error')}
      <form class="form-grid" method="POST" action="/login">
        <input type="hidden" name="next" value="${escapeHtml(next)}" />
        <div>
          <label for="username">Username</label>
          <input id="username" name="username" type="text" maxlength="24" required />
        </div>
        <div>
          <label for="password">Password</label>
          <input id="password" name="password" type="password" minlength="8" required />
        </div>
        <input type="submit" value="Sign In" />
      </form>
      <p class="helper">Need an account? <a href="/register${next ? `?next=${encodeURIComponent(next)}` : ''}">Create one</a>.</p>
    </section>
  `, { currentPath: requestUrl.pathname }));
}

async function handleLogin(request, response) {
  const body = await readBody(request);
  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  const next = safeNext(body.next);

  const user = await repositories.users.findByUsernameLower(username.toLowerCase());
  if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    return handleLoginPage(request, response, new URL(`/login?next=${encodeURIComponent(next)}`, BASE_URL), 'Invalid username or password.');
  }
  if (user.status !== 'active') {
    return handleLoginPage(request, response, new URL(`/login?next=${encodeURIComponent(next)}`, BASE_URL), 'This account is not active.');
  }

  const session = await createWebSession(user.id);
  await repositories.auditLogs.insert(createAuditLogEntry(
    user.id,
    'auth',
    'web_login',
    'web_session',
    session.id,
    '',
    {},
    session.createdAt
  ));
  setCookie(response, 'mcsr_web_session', session.token, WEB_SESSION_TTL_SECONDS);
  redirect(response, next || '/dashboard');
}

async function handleLogout(request, response) {
  const cookies = parseCookies(request.headers.cookie);
  const user = await getCurrentWebUser(request);
  if (cookies.mcsr_web_session) {
    await repositories.webSessions.deleteByToken(cookies.mcsr_web_session);
  }
  if (user) {
    await repositories.auditLogs.insert(createAuditLogEntry(
      user.id,
      'auth',
      'web_logout',
      'web_session',
      cookies.mcsr_web_session || '',
      '',
      {},
      Date.now()
    ));
  }
  clearCookie(response, 'mcsr_web_session');
  redirect(response, '/');
}

async function handleLinkPage(request, response, requestUrl, errorMessage) {
  const user = await getCurrentWebUser(request);
  if (!user) {
    const next = `/link${requestUrl.search ? requestUrl.search : ''}`;
    redirect(response, `/login?next=${encodeURIComponent(next)}`);
    return;
  }

  const userCode = normalizeUserCode(requestUrl.searchParams.get('code'));
  const deviceLink = userCode ? await findDeviceLinkByUserCode(userCode) : null;
  const statusBlock = renderDeviceLinkStatus(deviceLink, user);

  sendHtml(response, 200, renderPage('Approve Mod Link', `
    <section class="grid two">
      <article class="card">
        <h1>Approve Mod Link</h1>
        ${renderFlash(errorMessage, 'error')}
        <form class="form-grid" method="GET" action="/link">
          <div>
            <label for="code">Device Code</label>
            <input id="code" name="code" type="text" value="${escapeHtml(userCode)}" placeholder="ABCD-1234" />
          </div>
          <input type="submit" value="Load Device Request" />
        </form>
        <p class="helper">The mod opens this page with the code already filled in. You can also paste the code manually from the in-game account screen.</p>
      </article>
      <article class="card">
        <h2>Request Details</h2>
        ${statusBlock}
        ${renderLinkDecisionForms(deviceLink)}
      </article>
    </section>
  `, { user, currentPath: requestUrl.pathname }));
}

async function handleAdminPage(request, response, requestUrl, errorMessage) {
  const user = await getCurrentWebUser(request);
  if (!user) {
    redirect(response, '/login?next=%2Fadmin');
    return;
  }
  if (!isAdminUser(user)) {
    sendHtml(response, 403, renderPage('Admin Required', `
      <section class="card">
        <h1>Admin access required</h1>
        <p class="helper">This account is not configured for operator controls.</p>
      </section>
    `, { user, currentPath: requestUrl.pathname }));
    return;
  }

  const query = sanitizeDisplayText(requestUrl.searchParams.get('q'), 24).toLowerCase();
  let recentUsers = await listRecentUsers(40);
  if (query) {
    recentUsers = recentUsers.filter((entry) =>
      entry.user.usernameLower.includes(query) || entry.user.displayNameLower.includes(query)
    );
  }

  sendHtml(response, 200, renderPage('Admin Panel', `
    <section class="card">
      <h1>Admin Panel</h1>
      ${renderFlash(errorMessage, 'error')}
      <form class="form-grid" method="GET" action="/admin">
        <div>
          <label for="q">Find User</label>
          <input id="q" name="q" type="text" maxlength="24" value="${escapeHtml(query)}" placeholder="username or display name" />
        </div>
        <input type="submit" value="Filter Users" />
      </form>
      <p class="helper">These controls revoke active sessions and enforce account status across the website and mod backend.</p>
    </section>
    <section class="card">
      <h2>Recent Accounts</h2>
      ${recentUsers.length === 0 ? `
        <p class="helper">No users matched the current filter.</p>
      ` : `
        <div class="stats">
          ${recentUsers.map((entry) => renderAdminUserRow(entry)).join('')}
        </div>
      `}
    </section>
  `, { user, currentPath: requestUrl.pathname }));
}

async function handleAdminStatusUpdate(request, response) {
  const user = await getCurrentWebUser(request);
  if (!user) {
    redirect(response, '/login?next=%2Fadmin');
    return;
  }
  if (!isAdminUser(user)) {
    sendPlain(response, 403, 'Admin access required');
    return;
  }
  const body = await readBody(request);
  const targetUserId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
  const nextStatus = sanitizeDisplayText(body.status, 16).toLowerCase();
  const query = sanitizeDisplayText(body.q, 24);
  if (!targetUserId || !nextStatus) {
    return handleAdminPage(request, response, new URL(`/admin?q=${encodeURIComponent(query)}`, BASE_URL), 'User and status are required.');
  }
  if (targetUserId === user.id && nextStatus !== 'active') {
    return handleAdminPage(request, response, new URL(`/admin?q=${encodeURIComponent(query)}`, BASE_URL), 'Refusing to disable the current admin session.');
  }
  try {
    const updated = await updateUserStatus(targetUserId, nextStatus, user.id, 'admin_panel');
    if (!updated) {
      return handleAdminPage(request, response, new URL(`/admin?q=${encodeURIComponent(query)}`, BASE_URL), 'Target user was not found.');
    }
  } catch (error) {
    return handleAdminPage(request, response, new URL(`/admin?q=${encodeURIComponent(query)}`, BASE_URL), error.message || 'Unable to update account status.');
  }
  redirect(response, `/admin${query ? `?q=${encodeURIComponent(query)}` : ''}`);
}

async function handleAdminSessionRevoke(request, response) {
  const user = await getCurrentWebUser(request);
  if (!user) {
    redirect(response, '/login?next=%2Fadmin');
    return;
  }
  if (!isAdminUser(user)) {
    sendPlain(response, 403, 'Admin access required');
    return;
  }
  const body = await readBody(request);
  const targetUserId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
  const query = sanitizeDisplayText(body.q, 24);
  if (!targetUserId) {
    return handleAdminPage(request, response, new URL(`/admin?q=${encodeURIComponent(query)}`, BASE_URL), 'Target user is required.');
  }
  await revokeUserSessions(targetUserId, user.id, 'admin_panel');
  redirect(response, `/admin${query ? `?q=${encodeURIComponent(query)}` : ''}`);
}

async function handleLinkDecision(request, response, approve) {
  const user = await getCurrentWebUser(request);
  if (!user) {
    redirect(response, '/login?next=%2Flink');
    return;
  }

  const body = await readBody(request);
  const userCode = normalizeUserCode(body.user_code);
  const requestUrl = new URL(`/link?code=${encodeURIComponent(userCode)}`, BASE_URL);
  if (!userCode) {
    return handleLinkPage(request, response, requestUrl, 'Device code is required.');
  }

  const deviceLink = await repositories.deviceLinks.findByUserCode(userCode);
  if (!deviceLink) {
    return handleLinkPage(request, response, requestUrl, 'Device code was not found.');
  }

  if (deviceLink.expiresAt <= Date.now()) {
    deviceLink.status = 'expired';
    await repositories.deviceLinks.update(deviceLink);
    return handleLinkPage(request, response, requestUrl, 'This device code already expired.');
  }
  if (deviceLink.status !== 'pending') {
    return handleLinkPage(request, response, requestUrl, `This device request is already ${deviceLink.status}.`);
  }

  deviceLink.status = approve ? 'approved' : 'denied';
  deviceLink.approvedUserId = approve ? user.id : null;
  deviceLink.updatedAt = Date.now();
  await repositories.deviceLinks.update(deviceLink);
  await repositories.auditLogs.insert(createAuditLogEntry(
    user.id,
    'auth',
    approve ? 'approve_device_link' : 'deny_device_link',
    'device_link',
    deviceLink.id,
    '',
    {
      user_code: deviceLink.userCode,
      minecraft_name: deviceLink.minecraftName,
      loader: deviceLink.loader
    },
    deviceLink.updatedAt
  ));

  redirect(response, `/link?code=${encodeURIComponent(userCode)}`);
}

function renderLinkDecisionForms(deviceLink) {
  if (!deviceLink || deviceLink.status !== 'pending' || deviceLink.expiresAt <= Date.now()) {
    return '';
  }

  return `
    <div class="inline-actions">
      <form method="POST" action="/link/approve">
        <input type="hidden" name="user_code" value="${escapeHtml(deviceLink.userCode)}" />
        <input type="submit" value="Approve Mod Link" />
      </form>
      <form method="POST" action="/link/deny">
        <input type="hidden" name="user_code" value="${escapeHtml(deviceLink.userCode)}" />
        <button class="danger" type="submit">Deny</button>
      </form>
    </div>
  `;
}

function renderDeviceLinkStatus(deviceLink, currentUser) {
  if (!deviceLink) {
    return '<p class="helper">Load a valid device code to inspect and approve a mod link request.</p>';
  }

  const expired = deviceLink.expiresAt <= Date.now();
  const statusText = expired && deviceLink.status === 'pending' ? 'expired' : deviceLink.status;
  const approvedByCurrentUser = deviceLink.approvedUserId && deviceLink.approvedUserId === currentUser.id;

  return `
    <div class="stats">
      <div class="stat-row"><span>Device Code</span><strong>${escapeHtml(deviceLink.userCode)}</strong></div>
      <div class="stat-row"><span>Minecraft Name</span><strong>${escapeHtml(deviceLink.minecraftName)}</strong></div>
      <div class="stat-row"><span>Loader</span><strong>${escapeHtml(deviceLink.loader)}</strong></div>
      <div class="stat-row"><span>Scope</span><strong>${escapeHtml(deviceLink.scope)}</strong></div>
      <div class="stat-row"><span>Status</span><strong>${escapeHtml(statusText)}${approvedByCurrentUser ? ' by you' : ''}</strong></div>
    </div>
  `;
}

function renderAdminUserRow(entry) {
  const user = entry.user;
  const queryValue = `${user.username}`;
  const normalizedStatus = String(user.status || 'active').toLowerCase();
  const statusOptions = ['active', 'disabled', 'banned'].map((value) =>
    `<option value="${value}"${value === normalizedStatus ? ' selected' : ''}>${value}</option>`
  ).join('');
  return `
    <div class="admin-user-row">
      <div class="admin-user-meta">
        <div><strong>${escapeHtml(user.displayName)}</strong> <span class="helper">@${escapeHtml(user.username)}</span></div>
        <div class="helper">Elo ${user.elo} | ${escapeHtml(user.rankTier)} | ${escapeHtml(user.status)} | Mod sessions ${entry.activeModSessionCount}</div>
        <div class="helper">User ID: <code>${escapeHtml(user.id)}</code></div>
      </div>
      <div class="inline-actions">
        <form method="POST" action="/admin/users/status">
          <input type="hidden" name="user_id" value="${escapeHtml(user.id)}" />
          <input type="hidden" name="q" value="${escapeHtml(queryValue)}" />
          <select name="status">${statusOptions}</select>
          <input type="submit" value="Update Status" />
        </form>
        <form method="POST" action="/admin/users/revoke-sessions">
          <input type="hidden" name="user_id" value="${escapeHtml(user.id)}" />
          <input type="hidden" name="q" value="${escapeHtml(queryValue)}" />
          <button class="danger" type="submit">Revoke Sessions</button>
        </form>
      </div>
    </div>
  `;
}

function renderPage(title, content, options) {
  const user = options && options.user;
  const currentPath = options && options.currentPath ? options.currentPath : '/';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} | MCSR Auth</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div>
        <div class="brand">MCSR Auth</div>
        <div class="subtitle">Trusted website identity for the Minecraft speedrunning mod</div>
      </div>
      <nav class="nav">
        <a class="button secondary" href="/">Home</a>
        ${user ? `
          <a class="button secondary" href="/dashboard">Dashboard</a>
          <a class="button secondary" href="/link">Link Mod</a>
          <form method="POST" action="/logout">
            <button class="secondary" type="submit">Sign Out</button>
          </form>
        ` : `
          <a class="button secondary" href="/login${currentPath !== '/login' ? `?next=${encodeURIComponent(currentPath)}` : ''}">Sign In</a>
          <a class="button" href="/register">Create Account</a>
        `}
      </nav>
    </header>
    ${content}
  </div>
</body>
</html>`;
}

function renderFlash(message, kind) {
  if (!message) {
    return '';
  }
  return `<div class="flash ${kind || ''}">${escapeHtml(message)}</div>`;
}
