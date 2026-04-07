'use strict';

require('./src/utils/loadEnv').initializeRuntimeEnv();

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const USE_EXTERNAL_SERVER = process.env.MCSR_AUTH_EXTERNAL === '1';
let runtimeBaseUrl = process.env.MCSR_AUTH_BASE_URL || 'http://127.0.0.1:8080';
const TEST_MATCH_FILTER_ID = process.env.MCSR_TEST_MATCH_FILTER_ID
  || `mcsr_test_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const TEST_MATCH_SEED_TYPE_LABEL = process.env.MCSR_TEST_MATCH_SEED_TYPE_LABEL
  || `Test Queue ${TEST_MATCH_FILTER_ID.slice(-8)}`;

async function main() {
  const port = USE_EXTERNAL_SERVER ? null : (19200 + Math.floor(Math.random() * 500));
  runtimeBaseUrl = USE_EXTERNAL_SERVER ? runtimeBaseUrl : `http://127.0.0.1:${port}`;
  const server = USE_EXTERNAL_SERVER ? null : spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      HOST: '127.0.0.1',
      BASE_URL: runtimeBaseUrl,
      FSG_STATIC_SEED: process.env.FSG_STATIC_SEED || '123456789',
      FSG_STATIC_FILTER: process.env.FSG_STATIC_FILTER || 'zsg',
      FSG_STATIC_TOKEN: process.env.FSG_STATIC_TOKEN || 'test-token'
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
    const health = await getHealth();
    const storageBackend = String(health.storage_backend || 'json').toLowerCase();

    const playerOne = await createLinkedPlayer('host');
    const playerTwo = await createLinkedPlayer('opp');

    const firstMatch = await startRunningMatch(playerOne, playerTwo);
    const afterOneGenerated = firstMatch.afterOneGenerated;
    assert(afterOneGenerated.match.players.some((player) => player.world_status === 'generated'), 'loaded state missing after first world load');
    const runningSnapshot = firstMatch.runningSnapshot;
    assert.strictEqual(runningSnapshot.match.state, 'running', 'match never transitioned to running');

    const activitySnapshot = await matchmaker(playerOne.accessToken, {
      action: 'report_activity',
      match_id: firstMatch.matchId,
      type: 'advancement',
      activity_key: 'minecraft:story/enter_the_nether',
      status_text: 'Entered Nether',
      chat_message: 'We Need to Go Deeper',
      advancement_id: 'minecraft:story/enter_the_nether'
    });
    const opponentView = await matchmaker(playerTwo.accessToken, { action: 'poll_match', match_id: firstMatch.matchId });
    assert(activitySnapshot.match.events.length > 0, 'match event missing after activity report');
    assert(opponentView.match.players.some((player) => player.activity_status === 'Entered Nether'), 'opponent activity status did not propagate');

    const heartbeatSnapshot = await matchmaker(playerTwo.accessToken, {
      action: 'heartbeat',
      match_id: firstMatch.matchId
    });
    assert.strictEqual(heartbeatSnapshot.match.state, 'running', 'heartbeat should preserve running match state');

    const lateGeneratedSnapshot = await matchmaker(playerOne.accessToken, {
      action: 'mark_world_loaded',
      match_id: firstMatch.matchId
    });
    assert.strictEqual(lateGeneratedSnapshot.match.state, 'running', 'late generated update should not regress a running match');
    assert(lateGeneratedSnapshot.match.players.some((player) => player.player_id === playerOne.userId && player.world_status === 'running'), 'late generated update should not downgrade local running status');

    const finishSnapshot = await matchmaker(playerOne.accessToken, {
      action: 'report_finish',
      match_id: firstMatch.matchId,
      finish_time_ms: 1234567
    });
    assert.strictEqual(finishSnapshot.match.state, 'finished', 'finish did not finalize the match');
    assert.strictEqual(finishSnapshot.match.winner_player_id, playerOne.userId, 'winner player id mismatch after finish');
    assert(finishSnapshot.match.players.some((player) => player.player_id === playerOne.userId && player.result === 'win'), 'winner result missing');
    assert(finishSnapshot.match.players.some((player) => player.player_id === playerTwo.userId && player.result === 'loss'), 'loser result missing');

    const finishedEventCount = finishSnapshot.match.events.length;
    const lateActivitySnapshot = await matchmaker(playerTwo.accessToken, {
      action: 'report_activity',
      match_id: firstMatch.matchId,
      type: 'advancement',
      activity_key: 'minecraft:story/enter_the_nether',
      status_text: 'Entered Nether',
      chat_message: 'We Need to Go Deeper',
      advancement_id: 'minecraft:story/enter_the_nether'
    });
    assert.strictEqual(lateActivitySnapshot.match.state, 'finished', 'late activity should not regress a finished match');
    assert.strictEqual(lateActivitySnapshot.match.events.length, finishedEventCount, 'late activity should not append events after finish');

    const lateHeartbeatSnapshot = await matchmaker(playerTwo.accessToken, {
      action: 'heartbeat',
      match_id: firstMatch.matchId
    });
    assert.strictEqual(lateHeartbeatSnapshot.match.state, 'finished', 'late heartbeat should preserve finished match state');

    const winnerProfile = await getMe(playerOne.accessToken);
    const loserProfile = await getMe(playerTwo.accessToken);
    assert(winnerProfile.elo > 1200, 'winner Elo did not increase');
    assert(loserProfile.elo < 1200, 'loser Elo did not decrease');

    const secondMatch = await startRunningMatch(playerOne, playerTwo);
    const forfeitSnapshot = await matchmaker(playerTwo.accessToken, {
      action: 'forfeit_match',
      match_id: secondMatch.matchId
    });
    assert.strictEqual(forfeitSnapshot.match.state, 'finished', 'forfeit did not finalize the match');
    assert.strictEqual(forfeitSnapshot.match.winner_player_id, playerOne.userId, 'forfeit winner player id mismatch');
    assert(forfeitSnapshot.match.players.some((player) => player.player_id === playerTwo.userId && player.result === 'loss'), 'forfeit loser result missing');
    assert(forfeitSnapshot.match.events.some((event) => event.type === 'forfeit'), 'forfeit event missing');

    if (storageBackend === 'json') {
      const ratingHistory = readJsonTable('rating_history.json');
      const auditLogs = readJsonTable('audit_logs.json');
      assert(ratingHistory.filter((entry) => entry.matchId === finishSnapshot.match.id).length >= 2, 'rating history entries missing for finished match');
      assert(auditLogs.some((entry) => entry.matchId === finishSnapshot.match.id && entry.action === 'report_finish'), 'finish audit log missing for finished match');
      assert(auditLogs.some((entry) => entry.category === 'matchmaking' && entry.action === 'join_queue_matched' && entry.matchId === finishSnapshot.match.id), 'matchmade audit log missing');
      assert(auditLogs.some((entry) => entry.matchId === forfeitSnapshot.match.id && entry.action === 'forfeit_match'), 'forfeit audit log missing');
    }

    const requeueSnapshot = await matchmaker(playerOne.accessToken, {
      action: 'join_queue',
      seed_mode: 'MATCH',
      seed_type_label: TEST_MATCH_SEED_TYPE_LABEL,
      filter_ids: [TEST_MATCH_FILTER_ID]
    });
    assert.strictEqual(requeueSnapshot.queue_status, 'searching', 'requeue should not revive the previous opponent');
    assert(!requeueSnapshot.match, 'requeue unexpectedly returned the previous active match');

    const cancelledMatch = await createMatchedPair(playerOne, playerTwo);
    const cancelResponse = await matchmaker(playerOne.accessToken, {
      action: 'cancel_queue'
    });
    assert.strictEqual(cancelResponse.queue_status, 'cancelled', 'cancel queue should acknowledge cancellation');
    const cancelledView = await waitForMatchState(playerTwo.accessToken, cancelledMatch.matchId, 'aborted', 5000);
    assert.strictEqual(cancelledView.match.abort_reason, 'player_cancelled', 'opponent should see player_cancelled abort reason');

    console.log('Matchmaking flow passed.');
    console.log(`Match ID: ${finishSnapshot.match.id}`);
    console.log(`Seed: ${finishSnapshot.match.seed}`);
    console.log(`Winner Elo: ${winnerProfile.elo}`);
    console.log(`Loser Elo: ${loserProfile.elo}`);
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
    userId: poll.body.session.user.id,
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

async function getMe(accessToken) {
  const response = await fetch(`${runtimeBaseUrl}/mod-auth/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  assert.strictEqual(response.status, 200, `me failed: ${JSON.stringify(body)}`);
  return body;
}

async function waitForMatchState(accessToken, matchId, expectedState, timeoutMillis) {
  const deadline = Date.now() + timeoutMillis;
  while (Date.now() < deadline) {
    const snapshot = await matchmaker(accessToken, {
      action: 'heartbeat',
      match_id: matchId
    });
    if (snapshot.match && snapshot.match.state === expectedState) {
      return snapshot;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for match state ${expectedState}`);
}

async function startRunningMatch(playerOne, playerTwo) {
  const matchedPair = await createMatchedPair(playerOne, playerTwo);
  const joinTwo = matchedPair.matchSnapshot;

  await matchmaker(playerOne.accessToken, { action: 'begin_world_load', match_id: joinTwo.match.id });
  await matchmaker(playerTwo.accessToken, { action: 'begin_world_load', match_id: joinTwo.match.id });
  await matchmaker(playerOne.accessToken, { action: 'mark_world_loaded', match_id: joinTwo.match.id });
  const afterOneGenerated = await matchmaker(playerTwo.accessToken, { action: 'poll_match', match_id: joinTwo.match.id });
  await matchmaker(playerTwo.accessToken, { action: 'mark_world_loaded', match_id: joinTwo.match.id });
  const beforeCountdown = await matchmaker(playerTwo.accessToken, { action: 'poll_match', match_id: joinTwo.match.id });
  assert.strictEqual(beforeCountdown.match.state, 'world_generated', 'countdown should not start until both ready');

  const readySnapshots = await Promise.all([
    matchmaker(playerOne.accessToken, { action: 'mark_ready_locked', match_id: joinTwo.match.id }),
    matchmaker(playerTwo.accessToken, { action: 'mark_ready_locked', match_id: joinTwo.match.id })
  ]);
  const finalSnapshot = readySnapshots.find((snapshot) =>
    snapshot.match && snapshot.match.state === 'countdown' && snapshot.match.countdown_target_epoch_millis > Date.now()
  ) || await waitForMatchState(playerOne.accessToken, joinTwo.match.id, 'countdown', 5000);
  assert.strictEqual(finalSnapshot.match.state, 'countdown', 'countdown did not start after both ready');
  assert(finalSnapshot.match.countdown_target_epoch_millis > Date.now(), 'countdown target missing or invalid');

  const runningSnapshot = await waitForMatchState(playerOne.accessToken, joinTwo.match.id, 'running', 15000);
  return {
    matchId: joinTwo.match.id,
    seed: joinTwo.match.seed,
    afterOneGenerated,
    runningSnapshot
  };
}

async function createMatchedPair(playerOne, playerTwo) {
  const joinOne = await matchmaker(playerOne.accessToken, {
    action: 'join_queue',
    seed_mode: 'MATCH',
    seed_type_label: TEST_MATCH_SEED_TYPE_LABEL,
    filter_ids: [TEST_MATCH_FILTER_ID]
  });
  assert.strictEqual(joinOne.queue_status, 'searching', 'first player should still be searching');

  const joinOneRepeat = await matchmaker(playerOne.accessToken, {
    action: 'join_queue',
    seed_mode: 'MATCH',
    seed_type_label: TEST_MATCH_SEED_TYPE_LABEL,
    filter_ids: [TEST_MATCH_FILTER_ID]
  });
  assert.strictEqual(joinOneRepeat.queue_status, 'searching', 'repeated queue join should remain searching before an opponent is found');
  assert(!joinOneRepeat.match, 'repeated queue join should not synthesize a match before an opponent is found');

  const joinTwo = await matchmaker(playerTwo.accessToken, {
    action: 'join_queue',
    seed_mode: 'MATCH',
    seed_type_label: TEST_MATCH_SEED_TYPE_LABEL,
    filter_ids: [TEST_MATCH_FILTER_ID]
  });
  assert(joinTwo.match, 'second player did not receive a match');
  assert(joinTwo.match.seed, 'shared seed missing from match');
  assert.strictEqual(joinTwo.match.players.length, 2, 'expected two players in match');

  const joinOneAgain = await matchmaker(playerOne.accessToken, {
    action: 'join_queue',
    seed_mode: 'MATCH',
    seed_type_label: TEST_MATCH_SEED_TYPE_LABEL,
    filter_ids: [TEST_MATCH_FILTER_ID]
  });
  assert(joinOneAgain.match, 'first player should recover the active match instead of requeueing');
  assert.strictEqual(joinOneAgain.match.id, joinTwo.match.id, 'recovered match id mismatch for first player');

  const pollOne = await matchmaker(playerOne.accessToken, {
    action: 'poll_match',
    match_id: joinTwo.match.id
  });
  assert.strictEqual(pollOne.match.id, joinTwo.match.id, 'both players should see same match id');
  assert.strictEqual(pollOne.match.seed, joinTwo.match.seed, 'both players should see same shared seed');
  return {
    matchId: joinTwo.match.id,
    seed: joinTwo.match.seed,
    matchSnapshot: joinTwo
  };
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
  throw new Error('Matchmaking server did not become healthy in time');
}

async function getHealth() {
  const response = await fetch(`${runtimeBaseUrl}/health`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`health failed: HTTP ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : {};
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

function readJsonTable(fileName) {
  const filePath = path.join(__dirname, 'data', fileName);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
