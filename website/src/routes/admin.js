'use strict';

const { escapeHtml } = require('../utils/web');

async function adminRoutes(fastify) {
  const { repositories, authService, accountService } = fastify;

  // Admin auth check
  const requireAdmin = async (request, reply) => {
    await fastify.optionalWebAuth(request, reply);
    if (!request.user || !accountService.isAdminUser(request.user)) {
      return reply.status(403).type('text/html').send('<h1>Forbidden</h1><p>Admin access required.</p>');
    }
  };

  // ── GET /admin ──
  fastify.get('/', {
    preHandler: [requireAdmin]
  }, async (request, reply) => {
    const recentUsers = await accountService.listRecentUsers(50);

    const userRows = recentUsers.map((user) =>
      `<tr>
        <td>${escapeHtml(user.username)}</td>
        <td>${escapeHtml(user.displayName)}</td>
        <td>${user.elo}</td>
        <td>${escapeHtml(user.rankTier)}</td>
        <td>${escapeHtml(user.status)}</td>
        <td>
          <form method="POST" action="/admin/users/status" style="display:inline">
            <input type="hidden" name="user_id" value="${user.id}" />
            <input type="hidden" name="status" value="${user.status === 'active' ? 'banned' : 'active'}" />
            <button type="submit" class="btn-small">${user.status === 'active' ? 'Ban' : 'Unban'}</button>
          </form>
          <form method="POST" action="/admin/users/revoke-sessions" style="display:inline">
            <input type="hidden" name="user_id" value="${user.id}" />
            <button type="submit" class="btn-small">Revoke Sessions</button>
          </form>
        </td>
      </tr>`
    ).join('');

    const snapshot = await accountService.getSecuritySnapshot();
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin - MCSR Offline</title><link rel="stylesheet" href="/static/styles.css"></head><body><main>
      <h1>Admin Panel</h1>
      <div class="card">
        <h3>System</h3>
        <p>Total Users: ${snapshot.totalUsers} | Active Sessions: ${snapshot.activeSessions} | Uptime: ${Math.floor(process.uptime())}s</p>
      </div>
      <h2>Users</h2>
      <table>
        <thead><tr><th>Username</th><th>Display Name</th><th>Elo</th><th>Rank</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${userRows}</tbody>
      </table>
      <a href="/dashboard" class="btn btn-secondary">Back to Dashboard</a>
    </main></body></html>`;

    return reply.type('text/html').send(html);
  });

  // ── POST /admin/users/status ──
  fastify.post('/users/status', {
    schema: {
      body: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          status: { type: 'string', enum: ['active', 'banned', 'suspended'] }
        },
        required: ['user_id', 'status']
      }
    },
    preHandler: [requireAdmin]
  }, async (request, reply) => {
    await accountService.updateUserStatus(request.body.user_id, request.body.status);
    return reply.redirect('/admin');
  });

  // ── POST /admin/users/revoke-sessions ──
  fastify.post('/users/revoke-sessions', {
    schema: {
      body: {
        type: 'object',
        properties: {
          user_id: { type: 'string' }
        },
        required: ['user_id']
      }
    },
    preHandler: [requireAdmin]
  }, async (request, reply) => {
    await accountService.revokeUserSessions(request.body.user_id);
    return reply.redirect('/admin');
  });
}

module.exports = adminRoutes;
