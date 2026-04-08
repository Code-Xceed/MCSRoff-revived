'use strict';

require('./utils/loadEnv').initializeRuntimeEnv();

const { buildApp } = require('./app');
const config = require('./config');
const { logInfo, logError } = require('./utils/logger');

async function main() {
  const app = buildApp();

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    logInfo('server', `MCSR Offline server listening`, {
      port: config.PORT,
      host: config.HOST,
      storage: config.STORAGE_BACKEND,
      env: process.env.NODE_ENV || 'development'
    });
  } catch (err) {
    logError('server', 'Failed to start server', { error: err.message });
    process.exit(1);
  }
}

main();
