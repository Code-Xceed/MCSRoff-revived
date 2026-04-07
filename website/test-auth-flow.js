'use strict';

require('./src/utils/loadEnv').initializeRuntimeEnv();

const assert = require('assert');
const { spawn } = require('child_process');

const BASE_URL = process.env.MCSR_AUTH_BASE_URL || 'http://127.0.0.1:8080';
const USE_EXTERNAL_SERVER = process.env.MCSR_AUTH_EXTERNAL === '1';

async function main() {
  const server = USE_EXTERNAL_SERVER ? null : spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const shutdown = async () => {
    if (server && !server.killed) {
      server.kill();
    }
  };

  try {
    await waitForHealth();

    const username = `runner_${Date.now()}`;
    const displayName = `Runner${Date.now().toString().slice(-6)}`;
    const password = 'SpeedrunPass123';

    const registerResponse = await postForm('/register', {
      username,
      display_name: displayName,
      password,
      next: '/dashboard'
    });
    const sessionCookie = extractCookie(registerResponse, 'mcsr_web_session');
    assert(sessionCookie, 'web session cookie missing after registration');

    const startResponse = await postJson('/mod-auth/device/start', {
      minecraft_name: displayName,
      loader: 'fabric',
      scope: 'mcsr_mod'
    });
    assert.strictEqual(startResponse.statusCode, 200, 'device link start failed');
    assert(startResponse.body.user_code, 'device link user_code missing');
    assert(startResponse.body.device_code, 'device link device_code missing');

    const approveResponse = await postForm('/link/approve', {
      user_code: startResponse.body.user_code
    }, { Cookie: sessionCookie });
    assert.strictEqual(approveResponse.statusCode, 302, 'device approval did not redirect');

    const pollResponse = await postJson('/mod-auth/device/poll', {
      device_code: startResponse.body.device_code
    }, { Cookie: sessionCookie });
    
    assert.strictEqual(pollResponse.statusCode, 200, 'device poll failed');
    assert.strictEqual(pollResponse.body.status, 'approved', 'device link was not approved');
    assert.strictEqual(pollResponse.body.session.user.username, username, 'username mismatch after device approval');
    assert.strictEqual(pollResponse.body.session.user.display_name, displayName, 'display name mismatch after device approval');

    const meResponse = await getJson('/mod-auth/me', {
      Authorization: `Bearer ${pollResponse.body.session.access_token}`
    });
    assert.strictEqual(meResponse.statusCode, 200, '/me failed');
    assert.strictEqual(meResponse.body.username, username, 'username mismatch from /me');
    assert.strictEqual(meResponse.body.display_name, displayName, 'display name mismatch from /me');

    const refreshResponse = await postJson('/mod-auth/refresh', {
      refresh_token: pollResponse.body.session.refresh_token
    });
    assert.strictEqual(refreshResponse.statusCode, 200, 'refresh failed');
    assert.strictEqual(refreshResponse.body.user.username, username, 'username mismatch after refresh');
    assert.strictEqual(refreshResponse.body.user.display_name, displayName, 'display name mismatch after refresh');

    const meAfterRefresh = await getJson('/mod-auth/me', {
      Authorization: `Bearer ${refreshResponse.body.access_token}`
    });
    assert.strictEqual(meAfterRefresh.statusCode, 200, 'refreshed /me failed');
    assert.strictEqual(meAfterRefresh.body.username, username, 'username mismatch after refreshed /me');
    assert.strictEqual(meAfterRefresh.body.display_name, displayName, 'display name mismatch after refreshed /me');

    console.log('Auth flow passed.');
    console.log(`Username: ${username}`);
    console.log(`Display Name: ${displayName}`);
    console.log(`User ID: ${meAfterRefresh.body.id}`);
  } finally {
    await shutdown();
  }
}

async function waitForHealth() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
    }
    await sleep(300);
  }
  throw new Error('Auth website did not become healthy in time');
}

async function postJson(pathname, body, headers) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return {
    statusCode: response.status,
    body: JSON.parse(text)
  };
}

async function getJson(pathname, headers) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: 'GET',
    headers: headers || {}
  });
  const text = await response.text();
  return {
    statusCode: response.status,
    body: JSON.parse(text)
  };
}

async function postForm(pathname, body, headers) {
  const params = new URLSearchParams();
  Object.keys(body).forEach((key) => {
    params.set(key, body[key]);
  });

  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: 'POST',
    redirect: 'manual',
    headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers || {}),
    body: params.toString()
  });

  return {
    statusCode: response.status,
    headers: response.headers
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
