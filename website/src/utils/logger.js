'use strict';

function write(level, message, fields) {
  const payload = Object.assign({
    level,
    message,
    ts: new Date().toISOString()
  }, fields || {});
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  console.log(line);
}

function logInfo(message, fields) {
  write('info', message, fields);
}

function logWarn(message, fields) {
  write('warn', message, fields);
}

function logError(message, fields) {
  write('error', message, fields);
}

module.exports = {
  logInfo,
  logWarn,
  logError
};
