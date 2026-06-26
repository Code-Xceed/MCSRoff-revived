'use strict';

const { Pool } = require('pg');
const { logInfo, logError } = require('../utils/logger');

let pool = null;

function getPool() {
  if (pool) {
    return pool;
  }

  const connectionString = process.env.DATABASE_URL || '';
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required for direct Postgres access.');
  }

  pool = new Pool({
    connectionString,
    family:                   4,
    max:                      Number(process.env.PG_POOL_MAX || 20),
    idleTimeoutMillis:        Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis:  Number(process.env.PG_CONNECT_TIMEOUT_MS || 5000),
    statement_timeout:        Number(process.env.PG_STATEMENT_TIMEOUT_MS || 10000),
    ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });

  pool.on('error', (err) => {
    logError('pg_pool', 'Unexpected pool idle-client error', { error: err.message });
  });

  pool.on('connect', () => {
    logInfo('pg_pool', 'New client connected to Postgres');
  });

  return pool;
}

async function query(text, params) {
  const start = Date.now();
  const result = await getPool().query(text, params);
  const duration = Date.now() - start;
  if (duration > 500) {
    logInfo('pg_slow_query', 'Slow query detected', { text: text.substring(0, 120), duration, rows: result.rowCount });
  }
  return result;
}

async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function healthCheck() {
  try {
    const { rows } = await query('SELECT 1 AS ok');
    return rows[0] && rows[0].ok === 1;
  } catch {
    return false;
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    logInfo('pg_pool', 'Postgres pool closed');
  }
}

module.exports = { getPool, query, transaction, healthCheck, closePool };
