'use strict';

const Redis = require('ioredis');
const { logInfo, logWarn, logError } = require('../utils/logger');

let redis = null;
let fallbackMemory = null;

function getRedis() {
  if (redis) {
    return redis;
  }

  const url = process.env.REDIS_URL || '';
  if (!url) {
    logWarn('redis', 'No REDIS_URL configured — using in-memory fallback (not for production)');
    return getMemoryFallback();
  }

  redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      return Math.min(times * 200, 5000);
    },
    lazyConnect: false,
    enableReadyCheck: true,
    connectTimeout: 5000
  });

  redis.on('connect', () => logInfo('redis', 'Connected to Redis'));
  redis.on('error', (err) => logError('redis', 'Redis error', { error: err.message }));
  redis.on('close', () => logWarn('redis', 'Redis connection closed'));

  return redis;
}

function getMemoryFallback() {
  if (fallbackMemory) {
    return fallbackMemory;
  }

  const store = new Map();
  const expiries = new Map();

  function pruneExpired(key) {
    const exp = expiries.get(key);
    if (exp && Date.now() > exp) {
      store.delete(key);
      expiries.delete(key);
      return true;
    }
    return false;
  }

  fallbackMemory = {
    async get(key) {
      pruneExpired(key);
      const val = store.get(key);
      return val !== undefined ? val : null;
    },
    async set(key, value, ...args) {
      store.set(key, value);
      if (args[0] === 'EX' && args[1]) {
        expiries.set(key, Date.now() + Number(args[1]) * 1000);
      } else if (args[0] === 'PX' && args[1]) {
        expiries.set(key, Date.now() + Number(args[1]));
      }
      return 'OK';
    },
    async del(key) {
      store.delete(key);
      expiries.delete(key);
      return 1;
    },
    async incr(key) {
      pruneExpired(key);
      const val = Number(store.get(key) || 0) + 1;
      store.set(key, String(val));
      return val;
    },
    async expire(key, seconds) {
      expiries.set(key, Date.now() + seconds * 1000);
      return 1;
    },
    async ttl(key) {
      const exp = expiries.get(key);
      if (!exp) return -1;
      const remaining = Math.ceil((exp - Date.now()) / 1000);
      return remaining > 0 ? remaining : -2;
    },
    async keys(pattern) {
      const prefix = pattern.replace('*', '');
      return Array.from(store.keys()).filter((k) => k.startsWith(prefix));
    },
    async pipeline() {
      const commands = [];
      const pipe = {
        get(key) { commands.push(['get', key]); return pipe; },
        set(key, val, ...args) { commands.push(['set', key, val, ...args]); return pipe; },
        del(key) { commands.push(['del', key]); return pipe; },
        incr(key) { commands.push(['incr', key]); return pipe; },
        expire(key, s) { commands.push(['expire', key, s]); return pipe; },
        async exec() {
          const results = [];
          for (const [cmd, ...args] of commands) {
            results.push([null, await fallbackMemory[cmd](...args)]);
          }
          return results;
        }
      };
      return pipe;
    },
    async quit() { store.clear(); expiries.clear(); },
    status: 'ready'
  };

  return fallbackMemory;
}

async function healthCheck() {
  try {
    const r = getRedis();
    if (r === fallbackMemory) return true;
    const pong = await r.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

async function closeRedis() {
  if (redis) {
    await redis.quit();
    redis = null;
  }
  if (fallbackMemory) {
    await fallbackMemory.quit();
    fallbackMemory = null;
  }
}

module.exports = { getRedis, healthCheck, closeRedis };
