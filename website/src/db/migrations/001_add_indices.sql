-- Migration 001: Core indices for production performance
-- Run against your Postgres database to optimize hot-path queries

-- Active matches lookup (excludes terminal states)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_matches_state_active
  ON matches(state)
  WHERE state NOT IN ('finished', 'aborted');

-- Match players by match ID (used by every match fetch)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_match_players_match_id
  ON match_players(match_id);

-- Match players by player ID (used to find active match for user)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_match_players_player_id
  ON match_players(player_id);

-- Queue entries for matchmaking scan
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_queue_entries_status_searching
  ON queue_entries(status)
  WHERE status = 'searching';

-- Queue entries by player ID (upsert/find by player)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_queue_entries_player_id
  ON queue_entries(player_id);

-- Mod sessions: fast token lookup (hottest auth path)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mod_sessions_access_token_active
  ON mod_sessions(access_token)
  WHERE revoked_at IS NULL;

-- Mod sessions: refresh token lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mod_sessions_refresh_token
  ON mod_sessions(refresh_token);

-- Users by username (login path)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_app_users_username_lower
  ON app_users(username_lower);

-- Users by display name (registration uniqueness check)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_app_users_display_name_lower
  ON app_users(display_name_lower);

-- Web sessions by token (cookie auth path)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_web_sessions_token_active
  ON web_sessions(token)
  WHERE expires_at > NOW();

-- Device links by user code (linking flow)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_links_user_code
  ON device_links(user_code);

-- Device links by device code (polling flow)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_links_device_code
  ON device_links(device_code);

-- Match events by match ID (ordered fetch)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_match_events_match_id_seq
  ON match_events(match_id, seq);

-- Audit logs by user and timestamp (admin queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_created
  ON audit_logs(user_id, created_at DESC);

-- Rating history by user (profile page)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rating_history_user_created
  ON rating_history(user_id, created_at DESC);
