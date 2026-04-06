'use strict';

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

    const playerOne = await createLinkedPlayer('host');
    const playerTwo = await createLinkedPlayer('opp');

    const joinOne = await matchmaker(playerOne.accessToken, {
      action: 'join_queue',
      seed_mode: 'MATCH',
      seed_type_label: 'ZSG Mapless',
      filter_ids: ['zsg']
    });
    assert.strictEqual(joinOne.queue_status, 'searching', 'first player should still be searching');

    const joinTwo = await matchmaker(playerTwo.accessToken, {
      action: 'join_queue',
      seed_mode: 'MATCH',
      seed_type_label: 'ZSG Mapless',
      filter_ids: ['zsg']
    });
    assert(joinTwo.match, 'second player did not receive a match');
    assert(joinTwo.match.seed, 'shared seed missing from match');
    assert.strictEqual(joinTwo.match.players.length, 2, 'expected two players in match');

    const pollOne = await matchmaker(playerOne.accessToken, {
      action: 'poll_match',
      match_id: joinTwo.match.id
    });
    assert.strictEqual(pollOne.match.id, joinTwo.match.id, 'both players should see same match id');
    assert.strictEqual(pollOne.match.seed, joinTwo.match.seed, 'both players should see same shared seed');

    await matchmaker(playerOne.accessToken, { action: 'mark_world_generated', match_id: joinTwo.match.id });
    const afterOneGenerated = await matchmaker(playerTwo.accessToken, { action: 'poll_match', match_id: joinTwo.match.id });
    assert(afterOneGenerated.match.players.some((player) => player.world_status === 'generated'), 'generated state missing after first world generation');

    await matchmaker(playerTwo.accessToken, { action: 'mark_world_generated', match_id: joinTwo.match.id });
    await matchmaker(playerOne.accessToken, { action: 'mark_ready', match_id: joinTwo.match.id });
    const beforeCountdown = await matchmaker(playerTwo.accessToken, { action: 'poll_match', match_id: joinTwo.match.id });
    assert.strictEqual(beforeCountdown.match.state, 'world_generated', 'countdown should not start until both ready');

    const finalSnapshot = await matchmaker(playerTwo.accessToken, { action: 'mark_ready', match_id: joinTwo.match.id });
    assert.strictEqual(finalSnapshot.match.state, 'countdown', 'countdown did not start after both ready');
    assert(finalSnapshot.match.countdown_target_epoch_millis > Date.now(), 'countdown target missing or invalid');

    console.log('Matchmaking flow passed.');
    console.log(`Match ID: ${finalSnapshot.match.id}`);
    console.log(`Seed: ${finalSnapshot.match.seed}`);
    console.log(`Countdown Target: ${finalSnapshot.match.countdown_target_epoch_millis}`);
  } finally {
    await shutdown();
  }
}

async function createLinkedPlayer(prefix) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const username = `${prefix}_${stamp}`;
  const displayName = `${prefix.toUpperCase()}${stamp.slice(-6)}`;
  const password = 'SpeedrunPass123';

  const registerResponse = await postForm('/register', {
    username,
    display_name: displayName,
    password,
    next: '/dashboard'
  });
  const sessionCookie = extractCookie(registerResponse, 'mcsr_web_session');
  assert(sessionCookie, 'web session cookie missing');

  const start = await postJson('/mod-auth/device/start', {
    minecraft_name: displayName,
    loader: 'fabric',
    scope: 'mcsr_mod'
  });
  assert.strictEqual(start.statusCode, 200, 'device start failed');

  const approve = await postForm('/link/approve', {
    user_code: start.body.user_code
  }, { Cookie: sessionCookie });
  assert.strictEqual(approve.statusCode, 302, 'device approval failed');

  const poll = await postJson('/mod-auth/device/poll', {
    device_code: start.body.device_code
  });
  assert.strictEqual(poll.statusCode, 200, 'device poll failed');
  assert.strictEqual(poll.body.status, 'approved', 'device link not approved');

  return {
    username,
    displayName,
    accessToken: poll.body.session.access_token,
    refreshToken: poll.body.session.refresh_token
  };
}

async function matchmaker(accessToken, body) {
  const response = await postJson('/matchmaker', body, {
    Authorization: `Bearer ${accessToken}`
  });
  assert.strictEqual(response.statusCode, 200, `matchmaker failed: ${JSON.stringify(response.body)}`);
  return response.body;
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
  throw new Error('Matchmaking server did not become healthy in time');
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
    body: text ? JSON.parse(text) : {}
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
