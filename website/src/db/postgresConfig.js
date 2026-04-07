'use strict';

function getPostgresRuntimeConfig() {
  return {
    databaseUrl: process.env.DATABASE_URL || '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  };
}

function validatePostgresRuntimeConfig(config) {
  const errors = [];
  if (!config.databaseUrl && !(config.supabaseUrl && config.supabaseServiceRoleKey)) {
    errors.push('Set DATABASE_URL or both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  return errors;
}

module.exports = {
  getPostgresRuntimeConfig,
  validatePostgresRuntimeConfig
};
