'use strict';

require('../src/utils/loadEnv').initializeRuntimeEnv();

const { getPostgresRuntimeConfig, validatePostgresRuntimeConfig } = require('../src/db/postgresConfig');

async function main() {
  const config = getPostgresRuntimeConfig();
  const errors = validatePostgresRuntimeConfig(config);
  if (errors.length > 0) {
    throw new Error(errors.join(' '));
  }
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('This validator currently requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const restBaseUrl = `${config.supabaseUrl.replace(/\/$/, '')}/rest/v1`;
  const headers = {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    'Content-Type': 'application/json'
  };

  const requiredTables = [
    'app_users',
    'web_sessions',
    'device_links',
    'mod_sessions',
    'matches',
    'match_players',
    'queue_entries',
    'match_events',
    'rating_history',
    'audit_logs'
  ];

  const checks = [];
  for (const table of requiredTables) {
    await getJson(`${restBaseUrl}/${table}?select=*&limit=1`, headers);
    checks.push(`table:${table}`);
  }

  const probeMatchId = '00000000-0000-0000-0000-000000000001';
  const probeUserId = '00000000-0000-0000-0000-000000000002';
  await postJson(`${restBaseUrl}/rpc/mcsroff_release_queue_claim`, headers, {
    claim_match_id: probeMatchId,
    release_player_ids: [probeUserId],
    release_now: new Date().toISOString()
  });
  checks.push('rpc:mcsroff_release_queue_claim');

  await postJson(`${restBaseUrl}/rpc/mcsroff_claim_queue_opponent`, headers, {
    requesting_player_id: probeUserId,
    requested_seed_mode: 'MATCH',
    requested_filter_ids: ['zsg'],
    claim_match_id: probeMatchId,
    claim_now: new Date().toISOString(),
    stale_cutoff: new Date(Date.now() - 60000).toISOString()
  });
  checks.push('rpc:mcsroff_claim_queue_opponent');

  process.stdout.write(`Postgres runtime validation passed.\n${checks.join('\n')}\n`);
}

async function getJson(url, headers) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function postJson(url, headers, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {})
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${url} failed with HTTP ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
