'use strict';

const crypto = require('crypto');
const { hashPassword, verifyPassword, rankForElo } = require('../utils/auth');
const { sanitizeDisplayText, escapeHtml } = require('../utils/web');
const config = require('../config');

async function webRoutes(fastify) {
  const { repositories, authService, accountService } = fastify;

  // ── GET / ──
  fastify.get('/', {
    preHandler: [fastify.optionalWebAuth]
  }, async (request, reply) => {
    const user = request.user;
    if (!user) {
      return reply.type('text/html').send(renderLandingPage());
    }
    const links = await authService.getActiveDeviceLinksForUser(user.id);
    return reply.type('text/html').send(renderDashboard(user, links));
  });

  // ── GET /dashboard ──
  fastify.get('/dashboard', {
    preHandler: [fastify.optionalWebAuth]
  }, async (request, reply) => {
    const user = request.user;
    if (!user) return reply.redirect('/login');
    const links = await authService.getActiveDeviceLinksForUser(user.id);
    return reply.type('text/html').send(renderDashboard(user, links));
  });

  // ── GET /register ──
  fastify.get('/register', async (request, reply) => {
    return reply.type('text/html').send(renderRegisterPage(''));
  });

  // ── POST /register ──
  fastify.post('/register', {
    schema: {
      body: {
        type: 'object',
        properties: {
          username: { type: 'string', maxLength: 24 },
          display_name: { type: 'string', maxLength: 24 },
          password: { type: 'string', maxLength: 128 }
        },
        required: ['username', 'display_name', 'password']
      }
    }
  }, async (request, reply) => {
    const { username, display_name, password } = request.body;
    const cleanUsername = authService.normalizeUsername(username);
    const cleanDisplayName = authService.normalizeDisplayName(display_name);
    const validationError = authService.validateRegistration(cleanUsername, cleanDisplayName, password);
    if (validationError) {
      return reply.type('text/html').send(renderRegisterPage(validationError));
    }

    const existingUsername = await repositories.users.findByUsernameLower(cleanUsername.toLowerCase());
    if (existingUsername) {
      return reply.type('text/html').send(renderRegisterPage('Username already taken.'));
    }

    const existingDisplayName = await repositories.users.findByDisplayNameLower(cleanDisplayName.toLowerCase());
    if (existingDisplayName) {
      return reply.type('text/html').send(renderRegisterPage('Display name already taken.'));
    }

    const { hash, salt } = await hashPassword(password);
    const now = Date.now();
    const user = {
      id: crypto.randomUUID(),
      username: cleanUsername,
      usernameLower: cleanUsername.toLowerCase(),
      displayName: cleanDisplayName,
      displayNameLower: cleanDisplayName.toLowerCase(),
      passwordHash: hash,
      passwordSalt: salt,
      elo: 1200,
      rankTier: rankForElo(1200),
      status: 'active',
      createdAt: now,
      updatedAt: now
    };

    await repositories.users.insert(user);
    const session = await authService.createWebSession(user.id);
    reply.setCookie('mcsr_web_session', session.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: config.WEB_SESSION_TTL_SECONDS
    });
    return reply.redirect('/dashboard');
  });

  // ── GET /login ──
  fastify.get('/login', async (request, reply) => {
    return reply.type('text/html').send(renderLoginPage(''));
  });

  // ── POST /login ──
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        properties: {
          username: { type: 'string', maxLength: 24 },
          password: { type: 'string', maxLength: 128 }
        },
        required: ['username', 'password']
      }
    }
  }, async (request, reply) => {
    const { username, password } = request.body;
    const cleanUsername = authService.normalizeUsername(username);
    const user = await repositories.users.findByUsernameLower(cleanUsername.toLowerCase());
    if (!user) {
      return reply.type('text/html').send(renderLoginPage('Invalid username or password.'));
    }

    const valid = await verifyPassword(password, user.passwordHash, user.passwordSalt);
    if (!valid) {
      return reply.type('text/html').send(renderLoginPage('Invalid username or password.'));
    }
    if (user.status !== 'active') {
      return reply.type('text/html').send(renderLoginPage('Account is not active.'));
    }

    const session = await authService.createWebSession(user.id);
    reply.setCookie('mcsr_web_session', session.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: config.WEB_SESSION_TTL_SECONDS
    });
    return reply.redirect('/dashboard');
  });

  // ── POST /logout ──
  fastify.post('/logout', async (request, reply) => {
    const token = request.cookies && request.cookies.mcsr_web_session;
    if (token) {
      await repositories.webSessions.deleteByToken(token);
    }
    reply.clearCookie('mcsr_web_session', { path: '/' });
    return reply.redirect('/');
  });

  // ── GET /link ──
  fastify.get('/link', {
    preHandler: [fastify.requireWebAuth]
  }, async (request, reply) => {
    const links = await authService.getActiveDeviceLinksForUser(request.user.id);
    return reply.type('text/html').send(renderLinkPage(request.user, links, ''));
  });

  // ── POST /link/approve ──
  fastify.post('/link/approve', {
    schema: {
      body: {
        type: 'object',
        properties: {
          user_code: { type: 'string', maxLength: 16 }
        },
        required: ['user_code']
      }
    },
    preHandler: [fastify.requireWebAuth]
  }, async (request, reply) => {
    const userCode = authService.normalizeUserCode(request.body.user_code);
    const link = await authService.findDeviceLinkByUserCode(userCode);
    if (!link || link.status !== 'pending' || link.expiresAt <= Date.now()) {
      const links = await authService.getActiveDeviceLinksForUser(request.user.id);
      return reply.type('text/html').send(renderLinkPage(request.user, links, 'Link code not found or expired.'));
    }

    link.status = 'approved';
    link.approvedUserId = request.user.id;
    link.updatedAt = Date.now();
    await repositories.deviceLinks.update(link);
    return reply.redirect('/link');
  });

  // ── POST /link/deny ──
  fastify.post('/link/deny', {
    schema: {
      body: {
        type: 'object',
        properties: {
          user_code: { type: 'string', maxLength: 16 }
        },
        required: ['user_code']
      }
    },
    preHandler: [fastify.requireWebAuth]
  }, async (request, reply) => {
    const userCode = authService.normalizeUserCode(request.body.user_code);
    const link = await authService.findDeviceLinkByUserCode(userCode);
    if (link && link.status === 'pending') {
      link.status = 'denied';
      link.updatedAt = Date.now();
      await repositories.deviceLinks.update(link);
    }
    return reply.redirect('/link');
  });

  // ── GET /api/session ──
  fastify.get('/api/session', {
    preHandler: [fastify.optionalWebAuth]
  }, async (request, reply) => {
    if (!request.user) return reply.send({ authenticated: false });
    return reply.send({ authenticated: true, user: authService.publicUser(request.user) });
  });

  // ── HTML Renderers ──

  function renderLandingPage() {
    return wrapHtml('MCSR Offline', `
      <h1>MCSR Offline</h1>
      <p>Competitive 1v1 Minecraft Speedrun Races</p>
      <div class="actions">
        <a href="/login" class="btn">Login</a>
        <a href="/register" class="btn btn-secondary">Register</a>
      </div>
    `);
  }

  function renderDashboard(user, links) {
    const linkRows = (links || []).map((l) =>
      `<tr><td>${escapeHtml(l.minecraftName || '')}</td><td>${authService.formatDeviceStatus(l)}</td><td>${new Date(l.createdAt).toLocaleString()}</td></tr>`
    ).join('');

    return wrapHtml('Dashboard', `
      <h1>Dashboard</h1>
      <div class="card">
        <h2>${escapeHtml(user.displayName)}</h2>
        <p>Username: ${escapeHtml(user.username)} | Elo: ${user.elo} | Rank: ${escapeHtml(user.rankTier)}</p>
      </div>
      <h3>Device Links</h3>
      <table><thead><tr><th>Minecraft Name</th><th>Status</th><th>Created</th></tr></thead><tbody>${linkRows || '<tr><td colspan="3">No recent links</td></tr>'}</tbody></table>
      <div class="actions">
        <a href="/link" class="btn">Link Device</a>
        <form method="POST" action="/logout" style="display:inline"><button class="btn btn-secondary" type="submit">Logout</button></form>
      </div>
    `);
  }

  function renderRegisterPage(errorMsg) {
    return wrapHtml('Register', `
      <h1>Register</h1>
      ${errorMsg ? `<div class="error">${escapeHtml(errorMsg)}</div>` : ''}
      <form method="POST" action="/register">
        <label>Username<input name="username" required maxlength="24" /></label>
        <label>Display Name<input name="display_name" required maxlength="24" /></label>
        <label>Password<input name="password" type="password" required minlength="8" /></label>
        <button class="btn" type="submit">Register</button>
      </form>
      <p><a href="/login">Already have an account? Login</a></p>
    `);
  }

  function renderLoginPage(errorMsg) {
    return wrapHtml('Login', `
      <h1>Login</h1>
      ${errorMsg ? `<div class="error">${escapeHtml(errorMsg)}</div>` : ''}
      <form method="POST" action="/login">
        <label>Username<input name="username" required maxlength="24" /></label>
        <label>Password<input name="password" type="password" required /></label>
        <button class="btn" type="submit">Login</button>
      </form>
      <p><a href="/register">Don't have an account? Register</a></p>
    `);
  }

  function renderLinkPage(user, links, errorMsg) {
    const linkRows = (links || []).map((l) =>
      `<tr><td>${escapeHtml(l.userCode || '')}</td><td>${escapeHtml(l.minecraftName || '')}</td><td>${authService.formatDeviceStatus(l)}</td></tr>`
    ).join('');

    return wrapHtml('Link Device', `
      <h1>Link Mod to Account</h1>
      ${errorMsg ? `<div class="error">${escapeHtml(errorMsg)}</div>` : ''}
      <p>Enter the code shown in your Minecraft mod:</p>
      <form method="POST" action="/link/approve">
        <label>Device Code<input name="user_code" required maxlength="16" placeholder="XXXX-XXXX" /></label>
        <button class="btn" type="submit">Approve</button>
      </form>
      <h3>Recent Links</h3>
      <table><thead><tr><th>Code</th><th>Minecraft Name</th><th>Status</th></tr></thead><tbody>${linkRows || '<tr><td colspan="3">No recent links</td></tr>'}</tbody></table>
      <a href="/dashboard" class="btn btn-secondary">Back to Dashboard</a>
    `);
  }

  function wrapHtml(title, body) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - MCSR Offline</title><link rel="stylesheet" href="/static/styles.css"></head><body><main>${body}</main></body></html>`;
  }
}

module.exports = webRoutes;
