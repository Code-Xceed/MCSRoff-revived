'use strict';

const { getPostgresRuntimeConfig, validatePostgresRuntimeConfig } = require('../db/postgresConfig');

function createPostgresRepositories() {
  const config = getPostgresRuntimeConfig();
  const errors = validatePostgresRuntimeConfig(config);
  if (errors.length > 0) {
    throw new Error(`Postgres backend is not configured. ${errors.join(' ')}`);
  }
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('The current postgres repository implementation requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const restBaseUrl = `${config.supabaseUrl.replace(/\/$/, '')}/rest/v1`;
  const authHeaders = {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    'Content-Type': 'application/json'
  };

  async function request(method, table, options) {
    const query = new URLSearchParams();
    const params = options && options.params ? options.params : {};
    Object.keys(params).forEach((key) => {
      if (params[key] != null && params[key] !== '') {
        query.set(key, String(params[key]));
      }
    });
    const url = `${restBaseUrl}/${table}${query.toString() ? `?${query.toString()}` : ''}`;
    const headers = Object.assign({}, authHeaders, options && options.headers ? options.headers : {});
    const response = await fetch(url, {
      method,
      headers,
      body: options && options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`PostgREST ${method} ${table} failed with HTTP ${response.status}: ${text}`);
    }
    if (!text) {
      return null;
    }
    return JSON.parse(text);
  }

  async function rpc(functionName, body) {
    const response = await fetch(`${restBaseUrl}/rpc/${functionName}`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body || {})
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`PostgREST RPC ${functionName} failed with HTTP ${response.status}: ${text}`);
    }
    if (!text) {
      return null;
    }
    return JSON.parse(text);
  }

  function toIsoFromMillis(value) {
    if (!value) {
      return null;
    }
    const millis = Number(value);
    if (!Number.isFinite(millis) || millis <= 0) {
      return null;
    }
    return new Date(millis).toISOString();
  }

  function toMillisFromIso(value) {
    if (!value) {
      return 0;
    }
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : 0;
  }

  function mapUserFromRow(row) {
    return row ? {
      id: row.id,
      username: row.username,
      usernameLower: row.username_lower,
      displayName: row.display_name,
      displayNameLower: row.display_name_lower,
      passwordHash: row.password_hash,
      passwordSalt: row.password_salt,
      elo: row.elo,
      rankTier: row.rank_tier,
      status: row.status,
      createdAt: toMillisFromIso(row.created_at),
      updatedAt: toMillisFromIso(row.updated_at)
    } : null;
  }

  function mapWebSessionFromRow(row) {
    return row ? {
      id: row.id,
      userId: row.user_id,
      token: row.token,
      createdAt: toMillisFromIso(row.created_at),
      expiresAt: toMillisFromIso(row.expires_at)
    } : null;
  }

  function mapDeviceLinkFromRow(row) {
    return row ? {
      id: row.id,
      deviceCode: row.device_code,
      userCode: row.user_code,
      minecraftName: row.minecraft_name,
      loader: row.loader,
      scope: row.scope,
      status: row.status,
      approvedUserId: row.approved_user_id || null,
      modSessionId: row.mod_session_id || null,
      createdAt: toMillisFromIso(row.created_at),
      updatedAt: toMillisFromIso(row.updated_at),
      expiresAt: toMillisFromIso(row.expires_at)
    } : null;
  }

  function mapModSessionFromRow(row) {
    return row ? {
      id: row.id,
      userId: row.user_id,
      scope: row.scope,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      accessExpiresAt: toMillisFromIso(row.access_expires_at),
      refreshExpiresAt: toMillisFromIso(row.refresh_expires_at),
      createdAt: toMillisFromIso(row.created_at),
      updatedAt: toMillisFromIso(row.updated_at),
      revokedAt: row.revoked_at ? toMillisFromIso(row.revoked_at) : null
    } : null;
  }

  function mapQueueEntryFromRow(row) {
    return row ? {
      id: row.id,
      playerId: row.player_id,
      username: row.username,
      displayName: row.display_name,
      elo: row.elo,
      rankTier: row.rank_tier,
      seedMode: row.seed_mode,
      seedTypeLabel: row.seed_type_label,
      filterIds: Array.isArray(row.filter_ids) ? row.filter_ids : [],
      status: row.status,
      claimedMatchId: row.claimed_match_id || '',
      lastSeenAt: toMillisFromIso(row.last_seen_at),
      createdAt: toMillisFromIso(row.created_at),
      updatedAt: toMillisFromIso(row.updated_at),
      expiresAt: toMillisFromIso(row.expires_at)
    } : null;
  }

  function mapMatchPlayerFromRow(row) {
    return {
      playerId: row.player_id,
      username: row.username,
      displayName: row.display_name,
      eloSnapshot: row.elo_snapshot,
      rankSnapshot: row.rank_snapshot,
      slot: row.slot,
      connected: row.connected !== false,
      worldStatus: row.world_status,
      activityStatus: row.activity_status || '',
      lastSeenAt: toMillisFromIso(row.last_seen_at),
      readyAt: toMillisFromIso(row.ready_at),
      finishedAt: toMillisFromIso(row.finished_at),
      finishTimeMs: row.finish_time_ms || 0,
      result: row.result || '',
      createdAt: toMillisFromIso(row.created_at),
      updatedAt: toMillisFromIso(row.updated_at)
    };
  }

  function mapMatchEventFromRow(row) {
    return {
      seq: row.seq || 0,
      playerId: row.player_id || '',
      type: row.type || '',
      activityKey: row.activity_key || '',
      statusText: row.status_text || '',
      chatMessage: row.chat_message || '',
      advancementId: row.advancement_id || '',
      createdAt: toMillisFromIso(row.created_at)
    };
  }

  function mapMatchFromRows(matchRow, playerRows, eventRows) {
    return matchRow ? {
      id: matchRow.id,
      state: matchRow.state,
      seedMode: matchRow.seed_mode,
      seedTypeLabel: matchRow.seed_type_label,
      filterIds: Array.isArray(matchRow.filter_ids) ? matchRow.filter_ids : [],
      seed: matchRow.seed || '',
      fsgFilterId: matchRow.fsg_filter_id || '',
      fsgToken: matchRow.fsg_token || '',
      countdownTargetEpochMillis: matchRow.countdown_target_epoch_millis || 0,
      abortReason: matchRow.abort_reason || '',
      winnerPlayerId: matchRow.winner_player_id || '',
      nextEventSeq: matchRow.next_event_seq || 1,
      createdAt: toMillisFromIso(matchRow.created_at),
      updatedAt: toMillisFromIso(matchRow.updated_at),
      players: playerRows.map(mapMatchPlayerFromRow),
      events: eventRows.map(mapMatchEventFromRow)
    } : null;
  }

  function mapRatingHistoryFromRow(row) {
    return row ? {
      id: row.id,
      userId: row.user_id,
      matchId: row.match_id || '',
      previousElo: row.previous_elo || 0,
      newElo: row.new_elo || 0,
      delta: row.delta || 0,
      reason: row.reason || '',
      createdAt: toMillisFromIso(row.created_at)
    } : null;
  }

  function mapAuditLogFromRow(row) {
    return row ? {
      id: row.id,
      userId: row.user_id || null,
      category: row.category || '',
      action: row.action || '',
      targetType: row.target_type || '',
      targetId: row.target_id || '',
      matchId: row.match_id || '',
      details: row.details || {},
      createdAt: toMillisFromIso(row.created_at)
    } : null;
  }

  function worldStatusRank(status) {
    switch (String(status || '').toLowerCase()) {
      case 'queued': return 0;
      case 'generating': return 1;
      case 'generated': return 2;
      case 'ready': return 3;
      case 'running': return 4;
      case 'finished': return 5;
      case 'disconnected': return 6;
      default: return 0;
    }
  }

  function matchStateRank(state) {
    switch (String(state || '').toLowerCase()) {
      case 'matched': return 0;
      case 'world_generating': return 1;
      case 'world_generated': return 2;
      case 'countdown': return 3;
      case 'running': return 4;
      case 'finished': return 5;
      case 'aborted': return 6;
      default: return 0;
    }
  }

  function mergeMatchPlayer(existing, incoming) {
    const left = existing || {};
    const right = incoming || {};
    const leftUpdatedAt = Number(left.updatedAt || 0);
    const rightUpdatedAt = Number(right.updatedAt || 0);
    const mergedWorldStatus = worldStatusRank(right.worldStatus) >= worldStatusRank(left.worldStatus)
      ? (right.worldStatus || left.worldStatus || 'queued')
      : (left.worldStatus || right.worldStatus || 'queued');
    const preferRightText = rightUpdatedAt >= leftUpdatedAt;
    return {
      playerId: right.playerId || left.playerId || '',
      username: right.username || left.username || '',
      displayName: right.displayName || left.displayName || '',
      eloSnapshot: right.eloSnapshot != null ? right.eloSnapshot : (left.eloSnapshot || 1200),
      rankSnapshot: right.rankSnapshot || left.rankSnapshot || '',
      slot: right.slot || left.slot || '',
      connected: left.connected === false || right.connected === false ? false : (right.connected !== false && left.connected !== false),
      worldStatus: mergedWorldStatus,
      activityStatus: preferRightText ? (right.activityStatus || left.activityStatus || '') : (left.activityStatus || right.activityStatus || ''),
      lastSeenAt: Math.max(Number(left.lastSeenAt || 0), Number(right.lastSeenAt || 0)),
      readyAt: Math.max(Number(left.readyAt || 0), Number(right.readyAt || 0)),
      finishedAt: Math.max(Number(left.finishedAt || 0), Number(right.finishedAt || 0)),
      finishTimeMs: Math.max(Number(left.finishTimeMs || 0), Number(right.finishTimeMs || 0)),
      result: preferRightText ? (right.result || left.result || '') : (left.result || right.result || ''),
      createdAt: Math.min(Number(left.createdAt || 0) || Number(right.createdAt || 0), Number(right.createdAt || 0) || Number(left.createdAt || 0)),
      updatedAt: Math.max(leftUpdatedAt, rightUpdatedAt)
    };
  }

  function mergeMatch(existing, incoming) {
    if (!existing) {
      return incoming;
    }

    const mergedPlayersById = new Map();
    (existing.players || []).forEach((player) => {
      mergedPlayersById.set(player.playerId, player);
    });
    (incoming.players || []).forEach((player) => {
      const current = mergedPlayersById.get(player.playerId);
      mergedPlayersById.set(player.playerId, mergeMatchPlayer(current, player));
    });

    const mergedEventsBySeq = new Map();
    (existing.events || []).forEach((event) => {
      mergedEventsBySeq.set(String(event.seq || 0), event);
    });
    (incoming.events || []).forEach((event) => {
      mergedEventsBySeq.set(String(event.seq || 0), event);
    });

    const existingState = String(existing.state || '');
    const incomingState = String(incoming.state || '');
    let mergedState = matchStateRank(incomingState) >= matchStateRank(existingState) ? incomingState : existingState;
    if (!mergedState) {
      mergedState = existingState || incomingState || 'matched';
    }

    return {
      id: incoming.id || existing.id,
      state: mergedState,
      seedMode: incoming.seedMode || existing.seedMode || 'MATCH',
      seedTypeLabel: incoming.seedTypeLabel || existing.seedTypeLabel || '',
      filterIds: Array.isArray(incoming.filterIds) && incoming.filterIds.length > 0 ? incoming.filterIds : (existing.filterIds || []),
      seed: incoming.seed || existing.seed || '',
      fsgFilterId: incoming.fsgFilterId || existing.fsgFilterId || '',
      fsgToken: incoming.fsgToken || existing.fsgToken || '',
      countdownTargetEpochMillis: existing.countdownTargetEpochMillis > 0
        ? existing.countdownTargetEpochMillis
        : (incoming.countdownTargetEpochMillis || 0),
      abortReason: incoming.abortReason || existing.abortReason || '',
      winnerPlayerId: incoming.winnerPlayerId || existing.winnerPlayerId || '',
      nextEventSeq: Math.max(Number(existing.nextEventSeq || 1), Number(incoming.nextEventSeq || 1)),
      createdAt: Math.min(Number(existing.createdAt || 0) || Number(incoming.createdAt || 0), Number(incoming.createdAt || 0) || Number(existing.createdAt || 0)),
      updatedAt: Math.max(Number(existing.updatedAt || 0), Number(incoming.updatedAt || 0)),
      players: Array.from(mergedPlayersById.values()),
      events: Array.from(mergedEventsBySeq.values()).sort((left, right) => (left.seq || 0) - (right.seq || 0))
    };
  }

  async function fetchMatchRelations(matchIds) {
    if (!matchIds.length) {
      return { playersByMatchId: new Map(), eventsByMatchId: new Map() };
    }
    const idsExpr = `in.(${matchIds.join(',')})`;
    const [playerRows, eventRows] = await Promise.all([
      request('GET', 'match_players', {
        params: {
          select: '*',
          match_id: idsExpr
        }
      }),
      request('GET', 'match_events', {
        params: {
          select: '*',
          match_id: idsExpr,
          order: 'seq.asc'
        }
      })
    ]);

    const playersByMatchId = new Map();
    for (const row of playerRows || []) {
      const list = playersByMatchId.get(row.match_id) || [];
      list.push(row);
      playersByMatchId.set(row.match_id, list);
    }

    const eventsByMatchId = new Map();
    for (const row of eventRows || []) {
      const list = eventsByMatchId.get(row.match_id) || [];
      list.push(row);
      eventsByMatchId.set(row.match_id, list);
    }

    return { playersByMatchId, eventsByMatchId };
  }

  async function loadMatchesByRows(matchRows) {
    const ids = (matchRows || []).map((row) => row.id);
    const relations = await fetchMatchRelations(ids);
    return (matchRows || []).map((row) =>
      mapMatchFromRows(row, relations.playersByMatchId.get(row.id) || [], relations.eventsByMatchId.get(row.id) || [])
    );
  }

  async function loadMatchById(id) {
    const rows = await request('GET', 'matches', { params: { select: '*', id: `eq.${id}` } });
    const matches = await loadMatchesByRows(rows);
    return matches[0] || null;
  }

  async function replaceMatchChildren(match) {
    if (Array.isArray(match.players) && match.players.length > 0) {
      await request('POST', 'match_players', {
        headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
        params: { on_conflict: 'match_id,player_id' },
        body: match.players.map((player) => ({
          match_id: match.id,
          player_id: player.playerId,
          username: player.username,
          display_name: player.displayName,
          elo_snapshot: player.eloSnapshot,
          rank_snapshot: player.rankSnapshot,
          slot: player.slot,
          connected: player.connected !== false,
          world_status: player.worldStatus,
          activity_status: player.activityStatus || '',
          last_seen_at: toIsoFromMillis(player.lastSeenAt),
          ready_at: toIsoFromMillis(player.readyAt),
          finished_at: toIsoFromMillis(player.finishedAt),
          finish_time_ms: player.finishTimeMs || 0,
          result: player.result || '',
          created_at: toIsoFromMillis(player.createdAt),
          updated_at: toIsoFromMillis(player.updatedAt)
        }))
      });
    }

    if (Array.isArray(match.events) && match.events.length === 0) {
      await request('DELETE', 'match_events', {
        params: {
          match_id: `eq.${match.id}`
        }
      });
      return;
    }

    if (Array.isArray(match.events) && match.events.length > 0) {
      const minEventSeq = match.events.reduce((lowest, event) => Math.min(lowest, event.seq || 0), match.events[0].seq || 0);
      await request('DELETE', 'match_events', {
        params: {
          match_id: `eq.${match.id}`,
          seq: `lt.${minEventSeq}`
        }
      });
      await request('POST', 'match_events', {
        headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
        params: { on_conflict: 'match_id,seq' },
        body: match.events.map((event) => ({
          match_id: match.id,
          seq: event.seq || 0,
          player_id: event.playerId || null,
          type: event.type || '',
          activity_key: event.activityKey || '',
          status_text: event.statusText || '',
          chat_message: event.chatMessage || '',
          advancement_id: event.advancementId || '',
          created_at: toIsoFromMillis(event.createdAt)
        }))
      });
    }
  }

  const users = {
    getAll: async () => (await request('GET', 'app_users', { params: { select: '*' } })).map(mapUserFromRow),
    saveAll: async () => { throw new Error('saveAll is not supported for postgres users repository.'); },
    insert: async (user) => {
      const rows = await request('POST', 'app_users', {
        headers: { Prefer: 'return=representation' },
        body: {
          id: user.id,
          username: user.username,
          username_lower: user.usernameLower,
          display_name: user.displayName,
          display_name_lower: user.displayNameLower,
          password_hash: user.passwordHash,
          password_salt: user.passwordSalt,
          elo: user.elo,
          rank_tier: user.rankTier,
          status: user.status,
          created_at: toIsoFromMillis(user.createdAt),
          updated_at: toIsoFromMillis(user.updatedAt)
        }
      });
      return mapUserFromRow(rows[0]);
    },
    update: async (user) => {
      const rows = await request('PATCH', 'app_users', {
        headers: { Prefer: 'return=representation' },
        params: { id: `eq.${user.id}` },
        body: {
          username: user.username,
          username_lower: user.usernameLower,
          display_name: user.displayName,
          display_name_lower: user.displayNameLower,
          password_hash: user.passwordHash,
          password_salt: user.passwordSalt,
          elo: user.elo,
          rank_tier: user.rankTier,
          status: user.status,
          updated_at: toIsoFromMillis(user.updatedAt)
        }
      });
      return mapUserFromRow(rows[0]);
    },
    listRecent: async (limit) => {
      const rows = await request('GET', 'app_users', {
        params: {
          select: '*',
          order: 'updated_at.desc',
          limit: String(Math.max(0, Number(limit) || 0))
        }
      });
      return rows.map(mapUserFromRow);
    },
    findById: async (id) => {
      const rows = await request('GET', 'app_users', { params: { select: '*', id: `eq.${id}` } });
      return mapUserFromRow(rows[0]);
    },
    findByUsernameLower: async (usernameLower) => {
      const rows = await request('GET', 'app_users', { params: { select: '*', username_lower: `eq.${usernameLower}` } });
      return mapUserFromRow(rows[0]);
    },
    findByDisplayNameLower: async (displayNameLower) => {
      const rows = await request('GET', 'app_users', { params: { select: '*', display_name_lower: `eq.${displayNameLower}` } });
      return mapUserFromRow(rows[0]);
    }
  };

  const webSessions = {
    getAll: async () => (await request('GET', 'web_sessions', { params: { select: '*' } })).map(mapWebSessionFromRow),
    saveAll: async () => { throw new Error('saveAll is not supported for postgres webSessions repository.'); },
    findActiveByToken: async (token, now) => {
      const rows = await request('GET', 'web_sessions', {
        params: {
          select: '*',
          token: `eq.${token}`,
          expires_at: `gt.${new Date(now).toISOString()}`
        }
      });
      return mapWebSessionFromRow(rows[0]);
    },
    insert: async (session) => {
      const rows = await request('POST', 'web_sessions', {
        headers: { Prefer: 'return=representation' },
        body: {
          id: session.id,
          user_id: session.userId,
          token: session.token,
          created_at: toIsoFromMillis(session.createdAt),
          expires_at: toIsoFromMillis(session.expiresAt)
        }
      });
      return mapWebSessionFromRow(rows[0]);
    },
    deleteByToken: async (token) => {
      await request('DELETE', 'web_sessions', { params: { token: `eq.${token}` } });
    },
    deleteByUserId: async (userId) => {
      await request('DELETE', 'web_sessions', { params: { user_id: `eq.${userId}` } });
    }
  };

  const deviceLinks = {
    getAll: async () => (await request('GET', 'device_links', { params: { select: '*' } })).map(mapDeviceLinkFromRow),
    saveAll: async () => { throw new Error('saveAll is not supported for postgres deviceLinks repository.'); },
    findByUserCode: async (userCode) => {
      const rows = await request('GET', 'device_links', { params: { select: '*', user_code: `eq.${userCode}` } });
      return mapDeviceLinkFromRow(rows[0]);
    },
    findByDeviceCode: async (deviceCode) => {
      const rows = await request('GET', 'device_links', { params: { select: '*', device_code: `eq.${deviceCode}` } });
      return mapDeviceLinkFromRow(rows[0]);
    },
    insert: async (link) => {
      const rows = await request('POST', 'device_links', {
        headers: { Prefer: 'return=representation' },
        body: {
          id: link.id,
          device_code: link.deviceCode,
          user_code: link.userCode,
          minecraft_name: link.minecraftName,
          loader: link.loader,
          scope: link.scope,
          status: link.status,
          approved_user_id: link.approvedUserId,
          mod_session_id: link.modSessionId,
          created_at: toIsoFromMillis(link.createdAt),
          updated_at: toIsoFromMillis(link.updatedAt),
          expires_at: toIsoFromMillis(link.expiresAt)
        }
      });
      return mapDeviceLinkFromRow(rows[0]);
    },
    update: async (link) => {
      const rows = await request('PATCH', 'device_links', {
        headers: { Prefer: 'return=representation' },
        params: { id: `eq.${link.id}` },
        body: {
          status: link.status,
          approved_user_id: link.approvedUserId,
          mod_session_id: link.modSessionId,
          updated_at: toIsoFromMillis(link.updatedAt),
          expires_at: toIsoFromMillis(link.expiresAt)
        }
      });
      return mapDeviceLinkFromRow(rows[0]);
    },
    listRecentForUser: async (userId) => {
      const rows = await request('GET', 'device_links', {
        params: {
          select: '*',
          or: `(approved_user_id.eq.${userId},status.eq.pending)`,
          order: 'created_at.desc',
          limit: '6'
        }
      });
      return rows.map(mapDeviceLinkFromRow);
    }
  };

  const modSessions = {
    getAll: async () => (await request('GET', 'mod_sessions', { params: { select: '*' } })).map(mapModSessionFromRow),
    saveAll: async () => { throw new Error('saveAll is not supported for postgres modSessions repository.'); },
    findActiveByAccessToken: async (token, now) => {
      const rows = await request('GET', 'mod_sessions', {
        params: {
          select: '*',
          access_token: `eq.${token}`,
          access_expires_at: `gt.${new Date(now).toISOString()}`,
          revoked_at: 'is.null'
        }
      });
      return mapModSessionFromRow(rows[0]);
    },
    findById: async (id) => {
      const rows = await request('GET', 'mod_sessions', {
        params: { select: '*', id: `eq.${id}`, revoked_at: 'is.null' }
      });
      return mapModSessionFromRow(rows[0]);
    },
    findByRefreshToken: async (refreshToken) => {
      const rows = await request('GET', 'mod_sessions', { params: { select: '*', refresh_token: `eq.${refreshToken}` } });
      return mapModSessionFromRow(rows[0]);
    },
    replaceActiveForUserScope: async (userId, scope, nextSession, now) => {
      await request('PATCH', 'mod_sessions', {
        headers: { Prefer: 'return=minimal' },
        params: {
          user_id: `eq.${userId}`,
          scope: `eq.${scope}`,
          revoked_at: 'is.null'
        },
        body: {
          revoked_at: new Date(now).toISOString(),
          updated_at: new Date(now).toISOString()
        }
      });
      const rows = await request('POST', 'mod_sessions', {
        headers: { Prefer: 'return=representation' },
        body: {
          id: nextSession.id,
          user_id: nextSession.userId,
          scope: nextSession.scope,
          access_token: nextSession.accessToken,
          refresh_token: nextSession.refreshToken,
          access_expires_at: toIsoFromMillis(nextSession.accessExpiresAt),
          refresh_expires_at: toIsoFromMillis(nextSession.refreshExpiresAt),
          created_at: toIsoFromMillis(nextSession.createdAt),
          updated_at: toIsoFromMillis(nextSession.updatedAt),
          revoked_at: null
        }
      });
      return mapModSessionFromRow(rows[0]);
    },
    update: async (session) => {
      const rows = await request('PATCH', 'mod_sessions', {
        headers: { Prefer: 'return=representation' },
        params: { id: `eq.${session.id}` },
        body: {
          access_token: session.accessToken,
          refresh_token: session.refreshToken,
          access_expires_at: toIsoFromMillis(session.accessExpiresAt),
          refresh_expires_at: toIsoFromMillis(session.refreshExpiresAt),
          updated_at: toIsoFromMillis(session.updatedAt),
          revoked_at: session.revokedAt ? toIsoFromMillis(session.revokedAt) : null
        }
      });
      return mapModSessionFromRow(rows[0]);
    },
    listActiveByUserId: async (userId, now) => {
      const rows = await request('GET', 'mod_sessions', {
        params: {
          select: '*',
          user_id: `eq.${userId}`,
          revoked_at: 'is.null',
          refresh_expires_at: `gt.${new Date(now).toISOString()}`
        }
      });
      return rows.map(mapModSessionFromRow);
    },
    revokeByUserId: async (userId, now) => {
      await request('PATCH', 'mod_sessions', {
        headers: { Prefer: 'return=minimal' },
        params: {
          user_id: `eq.${userId}`,
          revoked_at: 'is.null'
        },
        body: {
          revoked_at: new Date(now).toISOString(),
          updated_at: new Date(now).toISOString()
        }
      });
    }
  };

  const queueEntries = {
    getAll: async () => (await request('GET', 'queue_entries', { params: { select: '*' } })).map(mapQueueEntryFromRow),
    saveAll: async () => { throw new Error('saveAll is not supported for postgres queueEntries repository.'); },
    findSearchingByPlayerId: async (playerId) => {
      const rows = await request('GET', 'queue_entries', {
        params: { select: '*', player_id: `eq.${playerId}`, status: 'eq.searching' }
      });
      return mapQueueEntryFromRow(rows[0]);
    },
    upsertSearching: async (entry) => {
      const rows = await request('POST', 'queue_entries', {
        headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
        params: { on_conflict: 'player_id' },
        body: {
          id: entry.id,
          player_id: entry.playerId,
          username: entry.username,
          display_name: entry.displayName,
          elo: entry.elo,
          rank_tier: entry.rankTier,
          seed_mode: entry.seedMode,
          seed_type_label: entry.seedTypeLabel,
          filter_ids: entry.filterIds || [],
          status: entry.status,
          claimed_match_id: entry.claimedMatchId || null,
          last_seen_at: toIsoFromMillis(entry.lastSeenAt),
          created_at: toIsoFromMillis(entry.createdAt),
          updated_at: toIsoFromMillis(entry.updatedAt),
          expires_at: toIsoFromMillis(entry.expiresAt)
        }
      });
      return mapQueueEntryFromRow(rows[0]);
    },
    claimCompatibleOpponent: async (requestedEntry, claimMatchId, now, staleMillis) => {
      const rows = await rpc('mcsroff_claim_queue_opponent', {
        requesting_player_id: requestedEntry.playerId,
        requested_seed_mode: requestedEntry.seedMode,
        requested_filter_ids: requestedEntry.filterIds || [],
        claim_match_id: claimMatchId,
        claim_now: new Date(now).toISOString(),
        stale_cutoff: new Date(now - staleMillis).toISOString()
      });
      return mapQueueEntryFromRow(Array.isArray(rows) ? rows[0] : rows);
    },
    releaseClaim: async (playerIds, claimMatchId, now) => {
      await rpc('mcsroff_release_queue_claim', {
        claim_match_id: claimMatchId,
        release_player_ids: playerIds || [],
        release_now: new Date(now).toISOString()
      });
    },
    removeByPlayerIds: async (playerIds) => {
      if (!playerIds || playerIds.length === 0) {
        return;
      }
      await request('DELETE', 'queue_entries', {
        params: { player_id: `in.(${playerIds.join(',')})` }
      });
    },
    pruneSearchingExpiredOrStale: async (now, staleMillis) => {
      const rows = await request('GET', 'queue_entries', { params: { select: '*' } });
      const staleIds = rows
        .map(mapQueueEntryFromRow)
        .filter((entry) =>
          !(entry.expiresAt > now
            && entry.status === 'searching'
            && (!entry.lastSeenAt || (now - entry.lastSeenAt) <= staleMillis))
        )
        .map((entry) => entry.id);
      if (staleIds.length > 0) {
        await request('DELETE', 'queue_entries', { params: { id: `in.(${staleIds.join(',')})` } });
      }
    }
  };

  const matches = {
    getAll: async () => loadMatchesByRows(await request('GET', 'matches', { params: { select: '*' } })),
    saveAll: async () => { throw new Error('saveAll is not supported for postgres matches repository.'); },
    findById: async (id) => {
      return loadMatchById(id);
    },
    insert: async (match) => {
      const rows = await request('POST', 'matches', {
        headers: { Prefer: 'return=representation' },
        body: {
          id: match.id,
          state: match.state,
          seed_mode: match.seedMode,
          seed_type_label: match.seedTypeLabel,
          filter_ids: match.filterIds || [],
          seed: match.seed || '',
          fsg_filter_id: match.fsgFilterId || '',
          fsg_token: match.fsgToken || '',
          countdown_target_epoch_millis: match.countdownTargetEpochMillis || 0,
          abort_reason: match.abortReason || '',
          winner_player_id: match.winnerPlayerId || null,
          next_event_seq: match.nextEventSeq || 1,
          created_at: toIsoFromMillis(match.createdAt),
          updated_at: toIsoFromMillis(match.updatedAt)
        }
      });
      await replaceMatchChildren(match);
      const inserted = await loadMatchesByRows(rows);
      return inserted[0] || null;
    },
    update: async (match) => {
      const existing = await loadMatchById(match.id);
      const mergedMatch = mergeMatch(existing, match);
      await request('PATCH', 'matches', {
        headers: { Prefer: 'return=minimal' },
        params: { id: `eq.${mergedMatch.id}` },
        body: {
          state: mergedMatch.state,
          seed_mode: mergedMatch.seedMode,
          seed_type_label: mergedMatch.seedTypeLabel,
          filter_ids: mergedMatch.filterIds || [],
          seed: mergedMatch.seed || '',
          fsg_filter_id: mergedMatch.fsgFilterId || '',
          fsg_token: mergedMatch.fsgToken || '',
          countdown_target_epoch_millis: mergedMatch.countdownTargetEpochMillis || 0,
          abort_reason: mergedMatch.abortReason || '',
          winner_player_id: mergedMatch.winnerPlayerId || null,
          next_event_seq: mergedMatch.nextEventSeq || 1,
          updated_at: toIsoFromMillis(mergedMatch.updatedAt)
        }
      });
      await replaceMatchChildren(mergedMatch);
      return loadMatchById(mergedMatch.id);
    },
    updatePlayer: async (matchId, playerId, fields) => {
      const body = {};
      if (fields.username !== undefined) body.username = fields.username;
      if (fields.displayName !== undefined) body.display_name = fields.displayName;
      if (fields.eloSnapshot !== undefined) body.elo_snapshot = fields.eloSnapshot;
      if (fields.rankSnapshot !== undefined) body.rank_snapshot = fields.rankSnapshot;
      if (fields.slot !== undefined) body.slot = fields.slot;
      if (fields.connected !== undefined) body.connected = fields.connected !== false;
      if (fields.worldStatus !== undefined) body.world_status = fields.worldStatus;
      if (fields.activityStatus !== undefined) body.activity_status = fields.activityStatus || '';
      if (fields.lastSeenAt !== undefined) body.last_seen_at = toIsoFromMillis(fields.lastSeenAt);
      if (fields.readyAt !== undefined) body.ready_at = toIsoFromMillis(fields.readyAt);
      if (fields.finishedAt !== undefined) body.finished_at = toIsoFromMillis(fields.finishedAt);
      if (fields.finishTimeMs !== undefined) body.finish_time_ms = fields.finishTimeMs || 0;
      if (fields.result !== undefined) body.result = fields.result || '';
      if (fields.updatedAt !== undefined) body.updated_at = toIsoFromMillis(fields.updatedAt);
      await request('PATCH', 'match_players', {
        headers: { Prefer: 'return=minimal' },
        params: {
          match_id: `eq.${matchId}`,
          player_id: `eq.${playerId}`
        },
        body
      });
      return loadMatchById(matchId);
    },
    findActiveByUserId: async (userId) => {
      const playerRows = await request('GET', 'match_players', {
        params: {
          select: 'match_id',
          player_id: `eq.${userId}`
        }
      });
      const matchIds = Array.from(new Set((playerRows || []).map((row) => row.match_id)));
      if (matchIds.length === 0) {
        return null;
      }
      const rows = await request('GET', 'matches', {
        params: {
          select: '*',
          id: `in.(${matchIds.join(',')})`
        }
      });
      const matches = await loadMatchesByRows(rows);
      const activeStates = new Set(['matched', 'world_generating', 'world_generated', 'countdown', 'running']);
      return matches.find((match) => activeStates.has(match.state)) || null;
    }
  };

  const ratingHistory = {
    getAll: async () => (await request('GET', 'rating_history', { params: { select: '*' } })).map(mapRatingHistoryFromRow),
    saveAll: async () => { throw new Error('saveAll is not supported for postgres ratingHistory repository.'); },
    insert: async (entry) => {
      const rows = await request('POST', 'rating_history', {
        headers: { Prefer: 'return=representation' },
        body: {
          id: entry.id,
          user_id: entry.userId,
          match_id: entry.matchId || null,
          previous_elo: entry.previousElo || 0,
          new_elo: entry.newElo || 0,
          delta: entry.delta || 0,
          reason: entry.reason || '',
          created_at: toIsoFromMillis(entry.createdAt)
        }
      });
      return mapRatingHistoryFromRow(rows[0]);
    }
  };

  const auditLogs = {
    getAll: async () => (await request('GET', 'audit_logs', { params: { select: '*' } })).map(mapAuditLogFromRow),
    saveAll: async () => { throw new Error('saveAll is not supported for postgres auditLogs repository.'); },
    insert: async (entry) => {
      const rows = await request('POST', 'audit_logs', {
        headers: { Prefer: 'return=representation' },
        body: {
          id: entry.id,
          user_id: entry.userId,
          category: entry.category || '',
          action: entry.action || '',
          target_type: entry.targetType || '',
          target_id: entry.targetId || '',
          match_id: entry.matchId || null,
          details: entry.details || {},
          created_at: toIsoFromMillis(entry.createdAt)
        }
      });
      return mapAuditLogFromRow(rows[0]);
    }
  };

  return {
    users,
    webSessions,
    deviceLinks,
    modSessions,
    queueEntries,
    matches,
    ratingHistory,
    auditLogs
  };
}

module.exports = {
  createPostgresRepositories
};
