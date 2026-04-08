'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');

let privateKey = null;
let publicKey = null;

if (process.env.JWT_PRIVATE_KEY_PATH && process.env.JWT_PUBLIC_KEY_PATH) {
  try {
    privateKey = fs.readFileSync(process.env.JWT_PRIVATE_KEY_PATH, 'utf8');
    publicKey = fs.readFileSync(process.env.JWT_PUBLIC_KEY_PATH, 'utf8');
  } catch (err) {
    console.warn('[JWT] Failed to read JWT keys from path, falling back to ephemeral keys.', err.message);
  }
}

if (!privateKey || !publicKey) {
  console.log('[JWT] Generating ephemeral RS256 key pair for development limit...');
  const { privateKey: pKey, publicKey: pubKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });
  privateKey = pKey;
  publicKey = pubKey;
}

function signSessionToken(payload, expiresInSeconds) {
  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: expiresInSeconds
  });
}

function verifySessionToken(token) {
  try {
    return jwt.verify(token, publicKey, { algorithms: ['RS256'] });
  } catch (err) {
    return null;
  }
}

module.exports = {
  signSessionToken,
  verifySessionToken
};
