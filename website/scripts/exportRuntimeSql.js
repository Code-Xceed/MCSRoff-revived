'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

const tables = {
  users: path.join(dataDir, 'users.json'),
  webSessions: path.join(dataDir, 'web_sessions.json'),
  deviceLinks: path.join(dataDir, 'device_links.json'),
  modSessions: path.join(dataDir, 'mod_sessions.json'),
  queueEntries: path.join(dataDir, 'queue_entries.json'),
  matches: path.join(dataDir, 'matches.json'),
  ratingHistory: path.join(dataDir, 'rating_history.json'),
  auditLogs: path.join(dataDir, 'audit_logs.json')
};

function readRows(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sqlString(value) {
  if (value == null) {
    return 'null';
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlBoolean(value) {
  return value ? 'true' : 'false';
}

function sqlBigInt(value) {
  return Number.isFinite(Number(value)) ? String(Math.trunc(Number(value))) : '0';
}

function sqlTimestampFromMillis(value) {
  if (!value) {
    return 'null';
  }
  const millis = Number(value);
  if (!Number.isFinite(millis) || millis <= 0) {
    return 'null';
  }
  return `to_timestamp(${(millis / 1000).toFixed(3)})`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value == null ? [] : value))}::jsonb`;
}

function row(tuple) {
  return `(${tuple.join(', ')})`;
}

function emitInsert(tableName, columns, rows) {
  if (!rows.length) {
    return `-- ${tableName}: no rows`;
  }
  return [
    `insert into public.${tableName} (${columns.join(', ')}) values`,
    rows.map((item) => `  ${item}`).join(',\n'),
    'on conflict do nothing;'
  ].join('\n');
}

function buildAppUsers(users) {
  return users.map((user) => row([
    sqlString(user.id),
    sqlString(user.username),
    sqlString(user.usernameLower || String(user.username || '').toLowerCase()),
    sqlString(user.displayName),
    sqlString(user.displayNameLower || String(user.displayName || '').toLowerCase()),
    sqlString(user.passwordHash),
    sqlString(user.passwordSalt),
    sqlBigInt(user.elo || 1200),
    sqlString(user.rankTier || 'Bronze I'),
    sqlString(user.status || 'active'),
    sqlTimestampFromMillis(user.createdAt),
    sqlTimestampFromMillis(user.updatedAt)
  ]));
}

function buildWebSessions(rows) {
  return rows.map((session) => row([
    sqlString(session.id),
    sqlString(session.userId),
    sqlString(session.token),
    sqlTimestampFromMillis(session.createdAt),
    sqlTimestampFromMillis(session.expiresAt)
  ]));
}

function buildDeviceLinks(rows) {
  return rows.map((link) => row([
    sqlString(link.id),
    sqlString(link.deviceCode),
    sqlString(link.userCode),
    sqlString(link.minecraftName),
    sqlString(link.loader),
    sqlString(link.scope),
    sqlString(link.status || 'pending'),
    sqlString(link.approvedUserId),
    sqlString(link.modSessionId),
    sqlTimestampFromMillis(link.createdAt),
    sqlTimestampFromMillis(link.updatedAt),
    sqlTimestampFromMillis(link.expiresAt)
  ]));
}

function buildModSessions(rows) {
  return rows.map((session) => row([
    sqlString(session.id),
    sqlString(session.userId),
    sqlString(session.scope || 'mcsr_mod'),
    sqlString(session.accessToken),
    sqlString(session.refreshToken),
    sqlTimestampFromMillis(session.accessExpiresAt),
    sqlTimestampFromMillis(session.refreshExpiresAt),
    sqlTimestampFromMillis(session.revokedAt),
    sqlTimestampFromMillis(session.createdAt),
    sqlTimestampFromMillis(session.updatedAt)
  ]));
}

function buildQueueEntries(rows) {
  return rows.map((entry) => row([
    sqlString(entry.id),
    sqlString(entry.playerId),
    sqlString(entry.username),
    sqlString(entry.displayName),
    sqlBigInt(entry.elo || 1200),
    sqlString(entry.rankTier || 'Bronze I'),
    sqlString(entry.seedMode || 'MATCH'),
    sqlString(entry.seedTypeLabel || 'Random FSG Race Pool'),
    sqlJson(entry.filterIds || []),
    sqlString(entry.status || 'searching'),
    sqlString(entry.claimedMatchId || null),
    sqlTimestampFromMillis(entry.lastSeenAt),
    sqlTimestampFromMillis(entry.createdAt),
    sqlTimestampFromMillis(entry.updatedAt),
    sqlTimestampFromMillis(entry.expiresAt)
  ]));
}

function buildMatches(rows) {
  return rows.map((match) => row([
    sqlString(match.id),
    sqlString(match.state || 'matched'),
    sqlString(match.seedMode || 'MATCH'),
    sqlString(match.seedTypeLabel || 'Random FSG Race Pool'),
    sqlJson(match.filterIds || []),
    sqlString(match.seed || ''),
    sqlString(match.fsgFilterId || ''),
    sqlString(match.fsgToken || ''),
    sqlBigInt(match.countdownTargetEpochMillis || 0),
    sqlString(match.abortReason || ''),
    sqlString(match.winnerPlayerId || null),
    sqlBigInt(match.nextEventSeq || 1),
    sqlTimestampFromMillis(match.createdAt),
    sqlTimestampFromMillis(match.updatedAt)
  ]));
}

function buildMatchPlayers(matches) {
  const rows = [];
  for (const match of matches) {
    for (const player of (match.players || [])) {
      rows.push(row([
        'gen_random_uuid()',
        sqlString(match.id),
        sqlString(player.playerId),
        sqlString(player.username),
        sqlString(player.displayName),
        sqlBigInt(player.eloSnapshot || 1200),
        sqlString(player.rankSnapshot || 'Bronze I'),
        sqlString(player.slot || 'host'),
        sqlBoolean(player.connected !== false),
        sqlString(player.worldStatus || 'queued'),
        sqlString(player.activityStatus || 'Started Match'),
        sqlTimestampFromMillis(player.lastSeenAt),
        sqlTimestampFromMillis(player.readyAt),
        sqlTimestampFromMillis(player.finishedAt),
        sqlBigInt(player.finishTimeMs || 0),
        sqlString(player.result || ''),
        sqlTimestampFromMillis(player.createdAt),
        sqlTimestampFromMillis(player.updatedAt)
      ]));
    }
  }
  return rows;
}

function buildMatchEvents(matches) {
  const rows = [];
  for (const match of matches) {
    for (const event of (match.events || [])) {
      rows.push(row([
        sqlString(match.id),
        sqlBigInt(event.seq || 0),
        sqlString(event.playerId || null),
        sqlString(event.type || 'activity'),
        sqlString(event.activityKey || ''),
        sqlString(event.statusText || ''),
        sqlString(event.chatMessage || ''),
        sqlString(event.advancementId || ''),
        sqlTimestampFromMillis(event.createdAt)
      ]));
    }
  }
  return rows;
}

function buildRatingHistory(rows) {
  return rows.map((entry) => row([
    sqlString(entry.id),
    sqlString(entry.userId),
    sqlString(entry.matchId || null),
    sqlBigInt(entry.previousElo || 0),
    sqlBigInt(entry.newElo || 0),
    sqlBigInt(entry.delta || 0),
    sqlString(entry.reason || 'match_result'),
    sqlTimestampFromMillis(entry.createdAt)
  ]));
}

function buildAuditLogs(rows) {
  return rows.map((entry) => row([
    sqlString(entry.id),
    sqlString(entry.userId || null),
    sqlString(entry.category || ''),
    sqlString(entry.action || ''),
    sqlString(entry.targetType || ''),
    sqlString(entry.targetId || ''),
    sqlString(entry.matchId || null),
    `${sqlString(JSON.stringify(entry.details || {}))}::jsonb`,
    sqlTimestampFromMillis(entry.createdAt)
  ]));
}

function main() {
  const users = readRows(tables.users);
  const webSessions = readRows(tables.webSessions);
  const deviceLinks = readRows(tables.deviceLinks);
  const modSessions = readRows(tables.modSessions);
  const queueEntries = readRows(tables.queueEntries);
  const matches = readRows(tables.matches);
  const ratingHistory = readRows(tables.ratingHistory);
  const auditLogs = readRows(tables.auditLogs);

  const output = [
    '-- Generated from website/data JSON runtime state.',
    '-- Apply after website/sql/runtime-postgres-schema.sql.',
    'begin;',
    emitInsert('app_users', [
      'id', 'username', 'username_lower', 'display_name', 'display_name_lower',
      'password_hash', 'password_salt', 'elo', 'rank_tier', 'status', 'created_at', 'updated_at'
    ], buildAppUsers(users)),
    emitInsert('web_sessions', [
      'id', 'user_id', 'token', 'created_at', 'expires_at'
    ], buildWebSessions(webSessions)),
    emitInsert('device_links', [
      'id', 'device_code', 'user_code', 'minecraft_name', 'loader', 'scope',
      'status', 'approved_user_id', 'mod_session_id', 'created_at', 'updated_at', 'expires_at'
    ], buildDeviceLinks(deviceLinks)),
    emitInsert('mod_sessions', [
      'id', 'user_id', 'scope', 'access_token', 'refresh_token',
      'access_expires_at', 'refresh_expires_at', 'revoked_at', 'created_at', 'updated_at'
    ], buildModSessions(modSessions)),
    emitInsert('matches', [
      'id', 'state', 'seed_mode', 'seed_type_label', 'filter_ids', 'seed',
      'fsg_filter_id', 'fsg_token', 'countdown_target_epoch_millis', 'abort_reason',
      'winner_player_id', 'next_event_seq', 'created_at', 'updated_at'
    ], buildMatches(matches)),
    emitInsert('match_players', [
      'id', 'match_id', 'player_id', 'username', 'display_name', 'elo_snapshot',
      'rank_snapshot', 'slot', 'connected', 'world_status', 'activity_status',
      'last_seen_at', 'ready_at', 'finished_at', 'finish_time_ms', 'result',
      'created_at', 'updated_at'
    ], buildMatchPlayers(matches)),
    emitInsert('queue_entries', [
      'id', 'player_id', 'username', 'display_name', 'elo', 'rank_tier',
      'seed_mode', 'seed_type_label', 'filter_ids', 'status', 'claimed_match_id',
      'last_seen_at', 'created_at', 'updated_at', 'expires_at'
    ], buildQueueEntries(queueEntries)),
    emitInsert('match_events', [
      'match_id', 'seq', 'player_id', 'type', 'activity_key', 'status_text',
      'chat_message', 'advancement_id', 'created_at'
    ], buildMatchEvents(matches)),
    emitInsert('rating_history', [
      'id', 'user_id', 'match_id', 'previous_elo', 'new_elo', 'delta', 'reason', 'created_at'
    ], buildRatingHistory(ratingHistory)),
    emitInsert('audit_logs', [
      'id', 'user_id', 'category', 'action', 'target_type', 'target_id', 'match_id', 'details', 'created_at'
    ], buildAuditLogs(auditLogs)),
    'commit;'
  ].join('\n\n');

  process.stdout.write(`${output}\n`);
}

main();
