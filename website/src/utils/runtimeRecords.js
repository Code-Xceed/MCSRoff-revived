'use strict';

const crypto = require('crypto');

function createAuditLogEntry(userId, category, action, targetType, targetId, matchId, details, createdAt) {
  return {
    id: crypto.randomUUID(),
    userId: userId || null,
    category: category || 'system',
    action: action || 'unknown',
    targetType: targetType || '',
    targetId: targetId || '',
    matchId: matchId || '',
    details: details || {},
    createdAt: createdAt || Date.now()
  };
}

function createRatingHistoryEntry(userId, matchId, previousElo, newElo, reason, createdAt) {
  const safePrevious = Number.isFinite(Number(previousElo)) ? Math.trunc(Number(previousElo)) : 0;
  const safeNext = Number.isFinite(Number(newElo)) ? Math.trunc(Number(newElo)) : 0;
  return {
    id: crypto.randomUUID(),
    userId: userId || null,
    matchId: matchId || '',
    previousElo: safePrevious,
    newElo: safeNext,
    delta: safeNext - safePrevious,
    reason: reason || 'match_result',
    createdAt: createdAt || Date.now()
  };
}

module.exports = {
  createAuditLogEntry,
  createRatingHistoryEntry
};
