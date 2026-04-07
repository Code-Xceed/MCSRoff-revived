'use strict';

const crypto = require('crypto');
const { PASSWORD_ITERATIONS } = require('../config');

function rankForElo(elo) {
  if (elo >= 1700) {
    return 'Master I';
  }
  if (elo >= 1550) {
    return 'Diamond I';
  }
  if (elo >= 1400) {
    return 'Platinum I';
  }
  if (elo >= 1250) {
    return 'Gold I';
  }
  if (elo >= 1100) {
    return 'Silver I';
  }
  return 'Bronze I';
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, 'sha256').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
  const calculated = crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, 'sha256');
  const expected = Buffer.from(storedHash, 'hex');
  return expected.length === calculated.length && crypto.timingSafeEqual(calculated, expected);
}

function createUserCode(existingLinks) {
  const used = new Set(existingLinks.map((item) => item.userCode));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    let raw = '';
    for (let index = 0; index < 8; index++) {
      raw += alphabet[crypto.randomInt(0, alphabet.length)];
    }
    code = `${raw.substring(0, 4)}-${raw.substring(4)}`;
  } while (used.has(code));
  return code;
}

module.exports = {
  rankForElo,
  hashPassword,
  verifyPassword,
  createUserCode
};
