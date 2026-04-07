'use strict';

require('./src/utils/loadEnv').initializeRuntimeEnv();

const assert = require('assert');
const { spawn } = require('child_process');

const USE_EXTERNAL_SERVER = process.env.MCSR_AUTH_EXTERNAL === '1';
let runtimeBaseUrl = process.env.MCSR_AUTH_BASE_URL || 'http://127.0.0.1:8080';

async function main() {
  const adminUsername = `admin_${Date.now()}`;
  const port = USE_EXTERNAL_SERVER ? null : (18600 + Math.floor(Math.random() * 500));
  runtimeBaseUrl = USE_EXTERNAL_SERVER ? runtimeBaseUrl : `http://127.0.0.1:${port}`;
  const server = USE_EXTERNAL_SERVER ? null : spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, {
      ADMIN_USERNAMES: adminUsername,
      PORT: String(port),
      HOST: '127.0.0.1',
      BASE_URL: runtimeBaseUrl
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const shutdown = async () => {
    if (server && !server.killed) {
      server.kill();
    }
  };

  try {
    await waitForHealth();

    const admin = await registerWebUser(adminUsername, `Admin${Date.now().toString().slice(-6)}`);
    const player = await createLinkedPlayer(`runner_${Date.now()}`, `Runner${Date.now().toString().slice(-6)}`);

    const adminPage = await getText('/admin', { Cookie: admin.cookie });
    assert.strictEqual(adminPage.statusCode, 200, 'admin page should load for configured admin account');

    const disableResponse = await postForm('/admin/users/status', {
      user_id: player.userId,
      status: 'disabled',
      q: player.username
    }, { Cookie: admin.cookie });
    assert.strictEqual(disableResponse.statusCode, 302, 'admin status update should redirect');

    const meAfterDisable = await getJson('/mod-auth/me', {
      Authorization: `Bearer ${player.accessToken}`
    });
    assert.strictEqual(meAfterDisable.statusCode, 401, 'disabled user access token should be revoked');

    const refreshAfterDisable = await postJson('/mod-auth/refresh', {
      refresh_token: player.refreshToken
    });
    assert.strictEqual(refreshAfterDisable.statusCode, 401, 'disabled user refresh token should be revoked');

    const loginAfterDisable = await postForm('/login', {
      username: player.username,
      password: player.password,
      next: '/dashboard'
    });
    assert.strictEqual(loginAfterDisable.statusCode, 200, 'disabled user login should stay on login page');

    const reactivateResponse = await postForm('/admin/users/status', {
      user_id: player.userId,
      status: 'active',
      q: player.username
    }, { Cookie: admin.cookie });
    assert.strictEqual(reactivateResponse.statusCode, 302, 'reactivate should redirect');

    const relinked = await createLinkedModSession(player.username, player.displayName, player.password);
    const meAfterReactivate = await getJson('/mod-auth/me', {
      Authorization: `Bearer ${relinked.accessToken}`
    });
    assert.strictEqual(meAfterReactivate.statusCode, 200, 'reactivated user should regain access');

    console.log('Admin moderation flow passed.');
    console.log(`Admin: ${admin.username}`);
    console.log(`Target User: ${player.username}`);
  } finally {
    await shutdown();
  }
}

async function registerWebUser(username, displayName) {
  const password = 'SpeedrunPass123';
  const registerResponse = await postForm('/register', {
    username,
    display_name: displayName,
    password,
    next: '/dashboard'
  });
  const sessionCookie = extractCookie(registerResponse, 'mcsr_web_session');
  assert(sessionCookie, 'web session cookie missing after registration');
  return {
    username,
    displayName,
    password,
    cookie: sessionCookie
  };
}

async function createLinkedPlayer(username, displayName) {
  const registered = await registerWebUser(username, displayName);
  const linked = await createLinkedModSession(username, displayName, registered.password, registered.cookie);
  return Object.assign({}, registered, linked);
}

async function createLinkedModSession(username, displayName, password, existingCookie) {
  const webCookie = existingCookie || await loginWebUser(username, password);
  const start = await postJson('/mod-auth/device/start', {
    minecraft_name: displayName,
    loader: 'fabric',
    scope: 'mcsr_mod'
  });
  assert.strictEqual(start.statusCode, 200, 'device start failed');

  const approve = await postForm('/link/approve', {
    user_code: start.body.user_code
  }, { Cookie: webCookie });
  assert.strictEqual(approve.statusCode, 302, 'device approval failed');

  const poll = await postJson('/mod-auth/device/poll', {
    device_code: start.body.device_code
  });
  assert.strictEqual(poll.statusCode, 200, 'device poll failed');
  assert.strictEqual(poll.body.status, 'approved', 'device link not approved');

  return {
    userId: poll.body.session.user.id,
    username,
    displayName,
    password,
    accessToken: poll.body.session.access_token,
    refreshToken: poll.body.session.refresh_token
  };
}

async function loginWebUser(username, password) {
  const response = await postForm('/login', {
    username,
    password,
    next: '/dashboard'
  });
  const sessionCookie = extractCookie(response, 'mcsr_web_session');
  assert(sessionCookie, 'web session cookie missing after login');
  return sessionCookie;
}

async function waitForHealth() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${runtimeBaseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
    }
    await sleep(300);
  }
  throw new Error('Admin test server did not become healthy in time');
}

async function getJson(pathname, headers) {
  const response = await fetch(`${runtimeBaseUrl}${pathname}`, {
    method: 'GET',
    headers: headers || {}
  });
  const text = await response.text();
  return {
    statusCode: response.status,
    body: text ? JSON.parse(text) : {}
  };
}

async function getText(pathname, headers) {
  const response = await fetch(`${runtimeBaseUrl}${pathname}`, {
    method: 'GET',
    headers: headers || {}
  });
  return {
    statusCode: response.status,
    body: await response.text()
  };
}

async function postJson(pathname, body, headers) {
  const response = await fetch(`${runtimeBaseUrl}${pathname}`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return {
    statusCode: response.status,
    body: text ? JSON.parse(text) : {}
  };
}

async function postForm(pathname, body, headers) {
  const params = new URLSearchParams();
  Object.keys(body).forEach((key) => {
    params.set(key, body[key]);
  });

  const response = await fetch(`${runtimeBaseUrl}${pathname}`, {
    method: 'POST',
    redirect: 'manual',
    headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers || {}),
    body: params.toString()
  });

  return {
    statusCode: response.status,
    headers: response.headers,
    body: await response.text()
  };
}

function extractCookie(response, name) {
  const rawCookie = response.headers.get('set-cookie');
  if (!rawCookie) {
    return '';
  }
  const firstPair = rawCookie.split(';')[0];
  return firstPair.startsWith(`${name}=`) ? firstPair : '';
}

function sleep(millis) {
  return new Promise((resolve) => setTimeout(resolve, millis));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
