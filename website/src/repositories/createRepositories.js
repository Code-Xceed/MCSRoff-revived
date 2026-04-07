'use strict';

const { createJsonRepositories } = require('./jsonRepositories');
const { createPostgresRepositories } = require('./postgresRepositories');

function createRepositories(options) {
  const backend = (options && options.backend ? String(options.backend) : 'json').toLowerCase();
  if (backend === 'postgres') {
    return createPostgresRepositories(options || {});
  }
  return createJsonRepositories(options.store);
}

module.exports = {
  createRepositories
};
