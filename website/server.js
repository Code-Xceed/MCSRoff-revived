'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL, URLSearchParams } = require('url');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const WEB_SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const DEVICE_LINK_TTL_SECONDS = 60 * 10;
const POLL_INTERVAL_SECONDS = 3;
const PASSWORD_ITERATIONS = 120000;

const TABLES = {
  users: path.join(DATA_DIR, 'users.json'),
  webSessions: path.join(DATA_DIR, 'web_sessions.json'),
  deviceLinks: path.join(DATA_DIR, 'device_links.json'),
  modSessions: path.join(DATA_DIR, 'mod_sessions.json'),
  queueEntries: path.join(DATA_DIR, 'queue_entries.json'),
  matches: path.join(DATA_DIR, 'matches.json')
};

ensureStorage();

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, BASE_URL);

  try {
    if (request.method === 'GET' && requestUrl.pathname === '/styles.css') {
      return serveStatic(response, path.join(PUBLIC_DIR, 'styles.css'), 'text/css; charset=utf-8');
    }
    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      return sendJson(response, 200, { ok: true, service: 'mcsroff-auth-site' });
    }
    if (request.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/dashboard')) {
      return handleDashboard(request, response, requestUrl);
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
    if (request.method === 'POST' && requestUrl.pathname === '/link/approve') {
      return handleLinkDecision(request, response, true);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/link/deny') {
      return handleLinkDecision(request, response, false);
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/session') {
      return handleSessionApi(request, response);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/mod-auth/device/start') {
      return handleDeviceStart(request, response);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/mod-auth/device/poll') {
      return handleDevicePoll(request, response);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/mod-auth/refresh') {
      return handleRefresh(request, response);
    }
    if (request.method === 'GET' && requestUrl.pathname === '/mod-auth/me') {
      return handleMe(request, response);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/matchmaker') {
      return handleMatchmaker(request, response);
    }

    sendHtml(response, 404, renderPage('Not Found', `
      <section class="card">
        <h1>Page not found</h1>
        <p class="helper">The route you requested does not exist.</p>
        <p><a class="button secondary" href="/">Return home</a></p>
      </section>
    `));
  } catch (error) {
    console.error('[auth-site] request failed', error);
    sendHtml(response, 500, renderPage('Server Error', `
      <section class="card">
        <h1>Server error</h1>
        <p class="helper">${escapeHtml(error.message || 'Unexpected failure')}</p>
      </section>
    `));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[auth-site] listening on ${BASE_URL}`);
});

async function handleDashboard(request, response, requestUrl) {
  const user = getCurrentWebUser(request);
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

  const pendingLinks = getActiveDeviceLinksForUser(user.id);
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
      <p class="footer-note">This scaffold stores data in local JSON files under <code>website/data</code>. Move these records to a database before public deployment.</p>
    </section>
  `, { user, currentPath: requestUrl.pathname }));
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

  const users = loadTable('users');
  if (findUserByUsername(users, username)) {
    return handleRegisterPage(request, response, new URL(`/register?next=${encodeURIComponent(next)}`, BASE_URL), 'That username is already taken.');
  }
  if (findUserByDisplayName(users, displayName)) {
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
  users.push(user);
  saveTable('users', users);

  const session = createWebSession(user.id);
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

  const users = loadTable('users');
  const user = findUserByUsername(users, username);
  if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    return handleLoginPage(request, response, new URL(`/login?next=${encodeURIComponent(next)}`, BASE_URL), 'Invalid username or password.');
  }
  if (user.status !== 'active') {
    return handleLoginPage(request, response, new URL(`/login?next=${encodeURIComponent(next)}`, BASE_URL), 'This account is not active.');
  }

  const session = createWebSession(user.id);
  setCookie(response, 'mcsr_web_session', session.token, WEB_SESSION_TTL_SECONDS);
  redirect(response, next || '/dashboard');
}

async function handleLogout(request, response) {
  const cookies = parseCookies(request.headers.cookie);
  if (cookies.mcsr_web_session) {
    const sessions = loadTable('webSessions').filter((session) => session.token !== cookies.mcsr_web_session);
    saveTable('webSessions', sessions);
  }
  clearCookie(response, 'mcsr_web_session');
  redirect(response, '/');
}

async function handleLinkPage(request, response, requestUrl, errorMessage) {
  const user = getCurrentWebUser(request);
  if (!user) {
    const next = `/link${requestUrl.search ? requestUrl.search : ''}`;
    redirect(response, `/login?next=${encodeURIComponent(next)}`);
    return;
  }

  const userCode = normalizeUserCode(requestUrl.searchParams.get('code'));
  const deviceLink = userCode ? findDeviceLinkByUserCode(userCode) : null;
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

async function handleLinkDecision(request, response, approve) {
  const user = getCurrentWebUser(request);
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

  const deviceLinks = loadTable('deviceLinks');
  const index = deviceLinks.findIndex((item) => item.userCode === userCode);
  if (index < 0) {
    return handleLinkPage(request, response, requestUrl, 'Device code was not found.');
  }

  const deviceLink = deviceLinks[index];
  if (deviceLink.expiresAt <= Date.now()) {
    deviceLink.status = 'expired';
    saveTable('deviceLinks', deviceLinks);
    return handleLinkPage(request, response, requestUrl, 'This device code already expired.');
  }
  if (deviceLink.status !== 'pending') {
    return handleLinkPage(request, response, requestUrl, `This device request is already ${deviceLink.status}.`);
  }

  deviceLink.status = approve ? 'approved' : 'denied';
  deviceLink.approvedUserId = approve ? user.id : null;
  deviceLink.updatedAt = Date.now();
  saveTable('deviceLinks', deviceLinks);

  redirect(response, `/link?code=${encodeURIComponent(userCode)}`);
}

async function handleSessionApi(request, response) {
  const user = getCurrentWebUser(request);
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

  const deviceLinks = loadTable('deviceLinks');
  const link = {
    id: crypto.randomUUID(),
    deviceCode: `dev_${crypto.randomBytes(18).toString('hex')}`,
    userCode: createUserCode(deviceLinks),
    minecraftName,
    loader,
    scope,
    status: 'pending',
    approvedUserId: null,
    modSessionId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + (DEVICE_LINK_TTL_SECONDS * 1000)
  };
  deviceLinks.push(link);
  saveTable('deviceLinks', deviceLinks);

  sendJson(response, 200, {
    device_code: link.deviceCode,
    user_code: link.userCode,
    verification_uri: `${BASE_URL}/link`,
    verification_uri_complete: `${BASE_URL}/link?code=${encodeURIComponent(link.userCode)}`,
    expires_in: DEVICE_LINK_TTL_SECONDS,
    interval: POLL_INTERVAL_SECONDS
  });
}

async function handleDevicePoll(request, response) {
  const body = await readBody(request);
  const deviceCode = typeof body.device_code === 'string' ? body.device_code.trim() : '';
  if (!deviceCode) {
    return sendJson(response, 400, { error: 'device_code is required' });
  }

  const deviceLinks = loadTable('deviceLinks');
  const index = deviceLinks.findIndex((item) => item.deviceCode === deviceCode);
  if (index < 0) {
    return sendJson(response, 404, { status: 'expired' });
  }

  const deviceLink = deviceLinks[index];
  if (deviceLink.expiresAt <= Date.now() && deviceLink.status === 'pending') {
    deviceLink.status = 'expired';
    saveTable('deviceLinks', deviceLinks);
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

  const user = findUserById(loadTable('users'), deviceLink.approvedUserId);
  if (!user || user.status !== 'active') {
    return sendJson(response, 403, { status: 'denied' });
  }

  let modSession = deviceLink.modSessionId ? findModSessionById(deviceLink.modSessionId) : null;
  if (!modSession || modSession.refreshExpiresAt <= Date.now() || modSession.accessExpiresAt <= Date.now()) {
    modSession = issueModSession(user.id, deviceLink.scope);
    deviceLink.modSessionId = modSession.id;
    deviceLink.updatedAt = Date.now();
    saveTable('deviceLinks', deviceLinks);
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

  const modSessions = loadTable('modSessions');
  const index = modSessions.findIndex((session) => session.refreshToken === refreshToken);
  if (index < 0) {
    return sendJson(response, 401, { error: 'Invalid refresh token' });
  }

  const session = modSessions[index];
  if (session.revokedAt || session.refreshExpiresAt <= Date.now()) {
    return sendJson(response, 401, { error: 'Refresh token expired' });
  }

  session.accessToken = `acc_${crypto.randomBytes(24).toString('hex')}`;
  session.refreshToken = `ref_${crypto.randomBytes(32).toString('hex')}`;
  session.accessExpiresAt = Date.now() + (ACCESS_TOKEN_TTL_SECONDS * 1000);
  session.refreshExpiresAt = Date.now() + (REFRESH_TOKEN_TTL_SECONDS * 1000);
  session.updatedAt = Date.now();
  saveTable('modSessions', modSessions);

  const user = findUserById(loadTable('users'), session.userId);
  if (!user || user.status !== 'active') {
    return sendJson(response, 403, { error: 'Account inactive' });
  }

  sendJson(response, 200, buildSessionPayload(session, user));
}

async function handleMe(request, response) {
  const modSession = getModSessionFromBearer(request);
  if (!modSession) {
    return sendJson(response, 401, { error: 'Unauthorized' });
  }

  const user = findUserById(loadTable('users'), modSession.userId);
  if (!user || user.status !== 'active') {
    return sendJson(response, 403, { error: 'Account inactive' });
  }

  sendJson(response, 200, publicUser(user));
}

async function handleMatchmaker(request, response) {
  const modSession = getModSessionFromBearer(request);
  if (!modSession) {
    return sendJson(response, 401, { error: 'Unauthorized' });
  }

  const user = findUserById(loadTable('users'), modSession.userId);
  if (!user || user.status !== 'active') {
    return sendJson(response, 403, { error: 'Account inactive' });
  }

  cleanupMatchmakerState();

  const body = await readBody(request);
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!action) {
    return sendJson(response, 400, { error: 'action is required' });
  }

  if (action === 'join_queue') {
    return handleJoinQueue(response, user, body);
  }
  if (action === 'poll_match') {
    return handlePollMatch(response, user, body);
  }
  if (action === 'cancel_queue') {
    return handleCancelQueue(response, user);
  }
  if (action === 'mark_world_generated') {
    return handleMarkWorldGenerated(response, user, body);
  }
  if (action === 'mark_ready') {
    return handleMarkReady(response, user, body);
  }

  return sendJson(response, 400, { error: 'Unknown action' });
}

async function handleJoinQueue(response, user, body) {
  const activeMatch = findActiveMatchForUser(user.id);
  if (activeMatch) {
    persistMatchState(activeMatch);
    return sendJson(response, 200, buildSnapshotResponse('matched', activeMatch));
  }

  const seedMode = normalizeSeedMode(body.seed_mode);
  const filterIds = sanitizeFilterIds(body.filter_ids);
  if (filterIds.length === 0) {
    return sendJson(response, 400, { error: 'At least one filter id is required' });
  }

  const queueEntries = loadTable('queueEntries');
  const existingQueueEntry = queueEntries.find((entry) => entry.playerId === user.id && entry.status === 'searching');
  const ownQueueEntry = {
    id: existingQueueEntry ? existingQueueEntry.id : crypto.randomUUID(),
    playerId: user.id,
    username: user.username,
    displayName: user.displayName,
    elo: user.elo,
    rankTier: user.rankTier,
    seedMode,
    seedTypeLabel: sanitizeDisplayText(body.seed_type_label, 48) || 'Random FSG Race Pool',
    filterIds,
    status: 'searching',
    claimedMatchId: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + (2 * 60 * 1000)
  };

  const opponentQueue = findCompatibleQueueEntry(queueEntries.filter((entry) => entry.playerId !== user.id), ownQueueEntry);
  if (!opponentQueue) {
    const nextQueueEntries = queueEntries.filter((entry) => entry.playerId !== user.id);
    nextQueueEntries.push(ownQueueEntry);
    saveTable('queueEntries', nextQueueEntries);
    return sendJson(response, 200, { queue_status: 'searching' });
  }

  const seedAssignment = await fetchFsgSeed(seedMode, intersectFilters(ownQueueEntry.filterIds, opponentQueue.filterIds));
  const match = createMatchFromQueue(ownQueueEntry, opponentQueue, seedAssignment);
  const remainingQueue = queueEntries.filter((entry) => entry.playerId !== opponentQueue.playerId);
  saveTable('queueEntries', remainingQueue);
  appendMatch(match);
  return sendJson(response, 200, buildSnapshotResponse('matched', match));
}

function handlePollMatch(response, user, body) {
  let match = null;
  const requestedMatchId = typeof body.match_id === 'string' ? body.match_id.trim() : '';
  if (requestedMatchId) {
    match = findMatchById(requestedMatchId);
  }
  if (!match) {
    match = findActiveMatchForUser(user.id);
  }
  if (!match) {
    return sendJson(response, 200, { queue_status: 'searching' });
  }

  persistMatchState(match);
  return sendJson(response, 200, buildSnapshotResponse('matched', match));
}

function handleCancelQueue(response, user) {
  const queueEntries = loadTable('queueEntries').filter((entry) => entry.playerId !== user.id);
  saveTable('queueEntries', queueEntries);

  const match = findActiveMatchForUser(user.id);
  if (match && match.state !== 'running' && match.state !== 'finished') {
    match.state = 'aborted';
    match.abortReason = 'player_cancelled';
    match.updatedAt = Date.now();
    const player = findMatchPlayer(match, user.id);
    if (player) {
      player.connected = false;
      player.worldStatus = 'disconnected';
      player.updatedAt = Date.now();
    }
    persistMatchState(match);
  }

  return sendJson(response, 200, { queue_status: 'cancelled' });
}

function handleMarkWorldGenerated(response, user, body) {
  const match = requireOwnedMatch(user.id, body.match_id);
  if (!match) {
    return sendJson(response, 404, { error: 'Match not found' });
  }

  const player = findMatchPlayer(match, user.id);
  player.worldStatus = 'generated';
  player.updatedAt = Date.now();
  updateMatchStateFromPlayers(match);
  persistMatchState(match);
  return sendJson(response, 200, buildSnapshotResponse('matched', match));
}

function handleMarkReady(response, user, body) {
  const match = requireOwnedMatch(user.id, body.match_id);
  if (!match) {
    return sendJson(response, 404, { error: 'Match not found' });
  }

  const player = findMatchPlayer(match, user.id);
  player.worldStatus = 'ready';
  player.readyAt = Date.now();
  player.updatedAt = Date.now();
  updateMatchStateFromPlayers(match);
  if (allPlayersAtLeast(match, 'ready') && !match.countdownTargetEpochMillis) {
    match.state = 'countdown';
    match.countdownTargetEpochMillis = Date.now() + 10000;
  }
  persistMatchState(match);
  return sendJson(response, 200, buildSnapshotResponse('matched', match));
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

function getCurrentWebUser(request) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies.mcsr_web_session;
  if (!token) {
    return null;
  }
  const sessions = loadTable('webSessions');
  const session = sessions.find((item) => item.token === token && item.expiresAt > Date.now());
  if (!session) {
    return null;
  }
  return findUserById(loadTable('users'), session.userId);
}

function createWebSession(userId) {
  const sessions = loadTable('webSessions').filter((session) => session.expiresAt > Date.now());
  const session = {
    id: crypto.randomUUID(),
    userId,
    token: `web_${crypto.randomBytes(32).toString('hex')}`,
    createdAt: Date.now(),
    expiresAt: Date.now() + (WEB_SESSION_TTL_SECONDS * 1000)
  };
  sessions.push(session);
  saveTable('webSessions', sessions);
  return session;
}

function getModSessionFromBearer(request) {
  const authorization = request.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) {
    return null;
  }
  const token = authorization.substring('Bearer '.length).trim();
  if (!token) {
    return null;
  }
  const sessions = loadTable('modSessions');
  return sessions.find((session) => session.accessToken === token && !session.revokedAt && session.accessExpiresAt > Date.now()) || null;
}

function issueModSession(userId, scope) {
  const now = Date.now();
  const modSessions = loadTable('modSessions').filter((session) => session.refreshExpiresAt > now);
  modSessions.forEach((session) => {
    if (!session.revokedAt && session.userId === userId && session.scope === scope) {
      session.revokedAt = now;
      session.updatedAt = now;
    }
  });
  const session = {
    id: crypto.randomUUID(),
    userId,
    scope,
    accessToken: `acc_${crypto.randomBytes(24).toString('hex')}`,
    refreshToken: `ref_${crypto.randomBytes(32).toString('hex')}`,
    accessExpiresAt: now + (ACCESS_TOKEN_TTL_SECONDS * 1000),
    refreshExpiresAt: now + (REFRESH_TOKEN_TTL_SECONDS * 1000),
    createdAt: now,
    updatedAt: now,
    revokedAt: null
  };
  modSessions.push(session);
  saveTable('modSessions', modSessions);
  return session;
}

function findModSessionById(id) {
  return loadTable('modSessions').find((session) => session.id === id && !session.revokedAt) || null;
}

function findDeviceLinkByUserCode(userCode) {
  return loadTable('deviceLinks').find((item) => item.userCode === userCode) || null;
}

function getActiveDeviceLinksForUser(userId) {
  return loadTable('deviceLinks')
    .filter((item) => item.approvedUserId === userId || item.status === 'pending')
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 6);
}

function findCompatibleQueueEntry(queueEntries, requestedEntry) {
  return queueEntries
    .filter((entry) =>
      entry.status === 'searching'
      && entry.expiresAt > Date.now()
      && entry.seedMode === requestedEntry.seedMode
      && intersectFilters(entry.filterIds, requestedEntry.filterIds).length > 0
    )
    .sort((left, right) => left.createdAt - right.createdAt)[0] || null;
}

function intersectFilters(left, right) {
  const rightSet = new Set((right || []).map((value) => String(value)));
  return (left || []).filter((value) => rightSet.has(String(value)));
}

function sanitizeFilterIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const ids = [];
  for (const item of value) {
    const text = sanitizeDisplayText(item, 32);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    ids.push(text);
  }
  return ids;
}

function normalizeSeedMode(value) {
  return String(value || '').toUpperCase() === 'PRACTICE' ? 'PRACTICE' : 'MATCH';
}

function createMatchFromQueue(hostEntry, opponentEntry, seedAssignment) {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    state: 'matched',
    seedMode: hostEntry.seedMode,
    seedTypeLabel: hostEntry.seedTypeLabel,
    filterIds: intersectFilters(hostEntry.filterIds, opponentEntry.filterIds),
    seed: String(seedAssignment.seed || ''),
    fsgFilterId: String(seedAssignment.filterId || ''),
    fsgToken: String(seedAssignment.token || ''),
    countdownTargetEpochMillis: 0,
    abortReason: '',
    winnerPlayerId: '',
    createdAt: now,
    updatedAt: now,
    players: [
      createMatchPlayer(hostEntry, 'host', now),
      createMatchPlayer(opponentEntry, 'opponent', now)
    ]
  };
}

function createMatchPlayer(queueEntry, slot, now) {
  return {
    playerId: queueEntry.playerId,
    username: queueEntry.username,
    displayName: queueEntry.displayName,
    eloSnapshot: queueEntry.elo,
    rankSnapshot: queueEntry.rankTier,
    slot,
    connected: true,
    worldStatus: 'queued',
    readyAt: 0,
    finishedAt: 0,
    finishTimeMs: 0,
    result: '',
    createdAt: now,
    updatedAt: now
  };
}

function appendMatch(match) {
  const matches = loadTable('matches');
  matches.push(match);
  saveTable('matches', matches);
}

function findMatchById(matchId) {
  if (!matchId) {
    return null;
  }
  const matches = loadTable('matches');
  return matches.find((match) => match.id === matchId) || null;
}

function findActiveMatchForUser(userId) {
  const matches = loadTable('matches');
  const activeStates = new Set(['matched', 'world_generating', 'world_generated', 'countdown', 'running']);
  return matches.find((match) =>
    activeStates.has(match.state)
    && Array.isArray(match.players)
    && match.players.some((player) => player.playerId === userId)
  ) || null;
}

function findMatchPlayer(match, userId) {
  return Array.isArray(match.players)
    ? match.players.find((player) => player.playerId === userId) || null
    : null;
}

function requireOwnedMatch(userId, matchId) {
  const match = findMatchById(typeof matchId === 'string' ? matchId.trim() : '');
  if (!match) {
    return null;
  }
  return findMatchPlayer(match, userId) ? match : null;
}

function updateMatchStateFromPlayers(match) {
  normalizeCountdownState(match);
  if (match.state === 'aborted' || match.state === 'finished' || match.state === 'running' || match.state === 'countdown') {
    return;
  }
  if (allPlayersAtLeast(match, 'ready')) {
    match.state = 'world_generated';
    return;
  }
  if (allPlayersAtLeast(match, 'generated')) {
    match.state = 'world_generated';
    return;
  }
  if (anyPlayerAtLeast(match, 'generated')) {
    match.state = 'world_generating';
    return;
  }
  match.state = 'matched';
}

function normalizeCountdownState(match) {
  if (match.state === 'countdown' && match.countdownTargetEpochMillis > 0 && Date.now() >= match.countdownTargetEpochMillis) {
    match.state = 'running';
    match.updatedAt = Date.now();
    if (Array.isArray(match.players)) {
      match.players.forEach((player) => {
        if (player.worldStatus === 'ready') {
          player.worldStatus = 'running';
          player.updatedAt = Date.now();
        }
      });
    }
  }
}

function anyPlayerAtLeast(match, targetStatus) {
  const targetStage = worldStage(targetStatus);
  return Array.isArray(match.players) && match.players.some((player) => worldStage(player.worldStatus) >= targetStage);
}

function allPlayersAtLeast(match, targetStatus) {
  const targetStage = worldStage(targetStatus);
  return Array.isArray(match.players)
    && match.players.length === 2
    && match.players.every((player) => worldStage(player.worldStatus) >= targetStage);
}

function worldStage(status) {
  if (status === 'ready') {
    return 3;
  }
  if (status === 'generated') {
    return 2;
  }
  if (status === 'generating') {
    return 1;
  }
  if (status === 'running') {
    return 4;
  }
  if (status === 'finished') {
    return 5;
  }
  return 0;
}

function persistMatchState(match) {
  normalizeCountdownState(match);
  updateMatchStateFromPlayers(match);
  match.updatedAt = Date.now();
  const matches = loadTable('matches');
  const index = matches.findIndex((item) => item.id === match.id);
  if (index >= 0) {
    matches[index] = match;
    saveTable('matches', matches);
  }
}

function cleanupMatchmakerState() {
  const now = Date.now();
  const queueEntries = loadTable('queueEntries').filter((entry) => entry.expiresAt > now && entry.status === 'searching');
  saveTable('queueEntries', queueEntries);

  const matches = loadTable('matches');
  let changed = false;
  for (const match of matches) {
    const previousState = match.state;
    normalizeCountdownState(match);
    if (match.state !== previousState) {
      match.updatedAt = now;
      changed = true;
    }
  }
  if (changed) {
    saveTable('matches', matches);
  }
}

function buildSnapshotResponse(queueStatus, match) {
  if (!match) {
    return { queue_status: queueStatus };
  }

  return {
    queue_status: queueStatus,
    match: {
      id: match.id,
      state: match.state,
      seed_mode: match.seedMode,
      seed_type_label: match.seedTypeLabel,
      seed: match.seed,
      fsg_filter_id: match.fsgFilterId,
      fsg_token: match.fsgToken,
      countdown_target_epoch_millis: match.countdownTargetEpochMillis || 0,
      players: (match.players || []).map((player) => ({
        player_id: player.playerId,
        username: player.username,
        display_name: player.displayName,
        elo_snapshot: player.eloSnapshot,
        rank_snapshot: player.rankSnapshot,
        slot: player.slot,
        world_status: player.worldStatus,
        connected: player.connected !== false
      }))
    }
  };
}

async function fetchFsgSeed(seedMode, filterIds) {
  const usableFilters = filterIds && filterIds.length > 0 ? filterIds : ['zsg'];
  if (seedMode === 'PRACTICE') {
    const selectedFilter = usableFilters[Math.floor(Math.random() * usableFilters.length)];
    const response = await fetch(`https://www.filteredseed.com/getRandomUsedSeed/${encodeURIComponent(selectedFilter)}`);
    if (!response.ok) {
      throw new Error(`FSG practice seed failed with HTTP ${response.status}`);
    }
    const body = await response.json();
    return {
      seed: body.seed || (body.data && body.data.seed) || '',
      filterId: selectedFilter,
      token: ''
    };
  }

  let url = '';
  if (usableFilters.length === 1) {
    url = `https://www.filteredseed.com/getSeed/${encodeURIComponent(usableFilters[0])}`;
  } else {
    const params = new URLSearchParams();
    usableFilters.forEach((filterId) => params.append('filters', filterId));
    url = `https://www.filteredseed.com/getSeedRandomFilter?${params.toString()}`;
  }

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0'
    }
  });
  if (!response.ok) {
    throw new Error(`FSG seed failed with HTTP ${response.status}`);
  }
  const body = await response.json();
  const payload = body && body.data ? body.data : body;
  return {
    seed: payload.seed || '',
    filterId: payload.filter || usableFilters[0],
    token: payload.token || ''
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

function rankForElo(elo) {
  if (elo >= 1700) {
    return 'Master I';
  }
  if (elo >= 1550) {
    return 'Diamond I';
  }
  if (elo >= 1400) {
    return 'Platinum I';
  }
  if (elo >= 1250) {
    return 'Gold I';
  }
  if (elo >= 1100) {
    return 'Silver I';
  }
  return 'Bronze I';
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, 'sha256').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
  const calculated = crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, 'sha256');
  const expected = Buffer.from(storedHash, 'hex');
  return expected.length === calculated.length && crypto.timingSafeEqual(calculated, expected);
}

function createUserCode(existingLinks) {
  const used = new Set(existingLinks.map((item) => item.userCode));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    let raw = '';
    for (let index = 0; index < 8; index++) {
      raw += alphabet[crypto.randomInt(0, alphabet.length)];
    }
    code = `${raw.substring(0, 4)}-${raw.substring(4)}`;
  } while (used.has(code));
  return code;
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

function safeNext(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    return '';
  }
  return value;
}

function sanitizeDisplayText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/[\r\n\t]/g, ' ').trim().substring(0, maxLength);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) {
    return cookies;
  }
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const divider = part.indexOf('=');
    if (divider < 0) {
      continue;
    }
    const key = part.substring(0, divider).trim();
    const value = part.substring(divider + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function setCookie(response, name, value, maxAgeSeconds) {
  response.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, maxAgeSeconds)}`);
}

function clearCookie(response, name) {
  response.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const filePath of Object.values(TABLES)) {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '[]\n', 'utf8');
    }
  }
}

function loadTable(name) {
  const filePath = TABLES[name];
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveTable(name, rows) {
  const filePath = TABLES[name];
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function serveStatic(response, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    sendPlain(response, 404, 'Not Found');
    return;
  }
  response.statusCode = 200;
  response.setHeader('Content-Type', contentType);
  response.end(fs.readFileSync(filePath));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const contentType = request.headers['content-type'] || '';
  if (!raw) {
    return {};
  }
  if (contentType.includes('application/json')) {
    return JSON.parse(raw);
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    const body = {};
    for (const [key, value] of params.entries()) {
      body[key] = value;
    }
    return body;
  }
  return {};
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendHtml(response, statusCode, html) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(html);
}

function sendPlain(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(body);
}

function redirect(response, location) {
  response.statusCode = 302;
  response.setHeader('Location', location);
  response.end();
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
