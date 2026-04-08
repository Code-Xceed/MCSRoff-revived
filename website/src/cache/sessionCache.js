'use strict';

const { getRedis } = require('./redis');

const SESSION_PREFIX = 'session:';
const USER_PREFIX = 'user:';
const SESSION_TTL = 3600;    // 1 hour
const USER_TTL = 300;        // 5 minutes

async function getCachedSession(accessToken) {
  if (!accessToken) return null;
  const raw = await getRedis().get(`${SESSION_PREFIX}${accessToken}`);
  return raw ? JSON.parse(raw) : null;
}

async function setCachedSession(accessToken, session) {
  if (!accessToken || !session) return;
  await getRedis().set(
    `${SESSION_PREFIX}${accessToken}`,
    JSON.stringify(session),
    'EX', SESSION_TTL
  );
}

async function invalidateSession(accessToken) {
  if (!accessToken) return;
  await getRedis().del(`${SESSION_PREFIX}${accessToken}`);
}

async function getCachedUser(userId) {
  if (!userId) return null;
  const raw = await getRedis().get(`${USER_PREFIX}${userId}`);
  return raw ? JSON.parse(raw) : null;
}

async function setCachedUser(userId, user) {
  if (!userId || !user) return;
  await getRedis().set(
    `${USER_PREFIX}${userId}`,
    JSON.stringify(user),
    'EX', USER_TTL
  );
}

async function invalidateUser(userId) {
  if (!userId) return;
  await getRedis().del(`${USER_PREFIX}${userId}`);
}

module.exports = {
  getCachedSession, setCachedSession, invalidateSession,
  getCachedUser, setCachedUser, invalidateUser
};
