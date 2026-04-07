'use strict';

const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const STORAGE_BACKEND = (process.env.STORAGE_BACKEND || 'json').toLowerCase();
const DATA_DIR = path.join(__dirname, '..', 'data');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const WEB_SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const DEVICE_LINK_TTL_SECONDS = 60 * 10;
const POLL_INTERVAL_SECONDS = 3;
const PASSWORD_ITERATIONS = 120000;
const MATCH_PLAYER_STALE_MILLIS = 15000;
const MATCH_PRESTART_STALE_MILLIS = 60000;
const MATCH_RUNNING_STALE_MILLIS = 180000;
const AUTH_RATE_LIMIT_WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 60_000);
const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX || 40);
const MATCH_RATE_LIMIT_WINDOW_MS = Number(process.env.MATCH_RATE_LIMIT_WINDOW_MS || 60_000);
const MATCH_RATE_LIMIT_MAX = Number(process.env.MATCH_RATE_LIMIT_MAX || 600);
const PAGE_RATE_LIMIT_WINDOW_MS = Number(process.env.PAGE_RATE_LIMIT_WINDOW_MS || 60_000);
const PAGE_RATE_LIMIT_MAX = Number(process.env.PAGE_RATE_LIMIT_MAX || 120);

const TABLES = {
  users: path.join(DATA_DIR, 'users.json'),
  webSessions: path.join(DATA_DIR, 'web_sessions.json'),
  deviceLinks: path.join(DATA_DIR, 'device_links.json'),
  modSessions: path.join(DATA_DIR, 'mod_sessions.json'),
  queueEntries: path.join(DATA_DIR, 'queue_entries.json'),
  matches: path.join(DATA_DIR, 'matches.json'),
  ratingHistory: path.join(DATA_DIR, 'rating_history.json'),
  auditLogs: path.join(DATA_DIR, 'audit_logs.json')
};

module.exports = {
  PORT,
  HOST,
  BASE_URL,
  STORAGE_BACKEND,
  DATA_DIR,
  PUBLIC_DIR,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  WEB_SESSION_TTL_SECONDS,
  DEVICE_LINK_TTL_SECONDS,
  POLL_INTERVAL_SECONDS,
  PASSWORD_ITERATIONS,
  MATCH_PLAYER_STALE_MILLIS,
  MATCH_PRESTART_STALE_MILLIS,
  MATCH_RUNNING_STALE_MILLIS,
  AUTH_RATE_LIMIT_WINDOW_MS,
  AUTH_RATE_LIMIT_MAX,
  MATCH_RATE_LIMIT_WINDOW_MS,
  MATCH_RATE_LIMIT_MAX,
  PAGE_RATE_LIMIT_WINDOW_MS,
  PAGE_RATE_LIMIT_MAX,
  TABLES
};
