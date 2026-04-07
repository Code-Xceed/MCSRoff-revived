'use strict';

const fs = require('fs');

function createJsonStore(dataDir, tables) {
  function ensureStorage() {
    fs.mkdirSync(dataDir, { recursive: true });
    for (const filePath of Object.values(tables)) {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '[]\n', 'utf8');
      }
    }
  }

  function loadTable(name) {
    const filePath = tables[name];
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  function saveTable(name, rows) {
    const filePath = tables[name];
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, filePath);
  }

  return {
    ensureStorage,
    loadTable,
    saveTable
  };
}

module.exports = {
  createJsonStore
};
