'use strict';

const fs = require('fs');
const path = require('path');

function parseDotEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }
  const divider = trimmed.indexOf('=');
  if (divider < 0) {
    return null;
  }
  const key = trimmed.substring(0, divider).trim();
  if (!key) {
    return null;
  }
  let value = trimmed.substring(divider + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
    value = value.substring(1, value.length - 1);
  }
  return { key, value };
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseDotEnvLine(line);
    if (!parsed) {
      continue;
    }
    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

function initializeRuntimeEnv() {
  const rootEnvPath = path.join(__dirname, '..', '..', '.env');
  loadDotEnv(rootEnvPath);
}

module.exports = {
  initializeRuntimeEnv
};
