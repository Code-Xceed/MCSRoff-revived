const fs = require('fs'); 
const content = fs.readFileSync('src/repositories/postgresRepositories.js', 'utf8'); 

const newTop = `'use strict';

const { query } = require('../db/pool');

function createPostgresRepositories() {
  function toIsoFromMillis(value) {
    if (!value) return null;
    const millis = Number(value);
    if (!Number.isFinite(millis) || millis <= 0) return null;
    return new Date(millis).toISOString();
  }

  function toMillisFromIso(value) {
    if (!value) return 0;
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : 0;
  }

  async function request(method, table, options = {}) {
    const params = options.params || {};
    const body = options.body;
    let sql = '';
    const values = [];

    if (method === 'GET') {
      const select = params.select || '*';
      sql = \`SELECT \${select} FROM \${table}\`;
      const wheres = [];
      
      for (const [key, val] of Object.entries(params)) {
        if (key === 'select' || key === 'order' || key === 'limit') continue;
        if (key === 'or') {
          const inner = val.substring(1, val.length - 1);
          const parts = inner.split(',');
          const orConds = parts.map(p => {
             const [col, op, ...rest] = p.split('.');
             const v = rest.join('.');
             if (op === 'eq') { values.push(v); return \`\${col} = $\${values.length}\`; }
             return '';
          });
          wheres.push(\`(\${orConds.join(' OR ')})\`);
          continue;
        }
        
        const [op, ...rest] = val.split('.');
        const v = rest.join('.');
        if (op === 'eq') { values.push(v); wheres.push(\`\${key} = $\${values.length}\`); }
        else if (op === 'gt') { values.push(v); wheres.push(\`\${key} > $\${values.length}\`); }
        else if (op === 'lt') { values.push(v); wheres.push(\`\${key} < $\${values.length}\`); }
        else if (op === 'in') {
          const list = v.substring(1, val.length - 1).split(',');
          const placeholders = list.map(item => {
            values.push(item);
            return \`$\${values.length}\`;
          }).join(',');
          wheres.push(\`\${key} IN (\${placeholders})\`);
        }
        else if (op === 'is' && v === 'null') {
          wheres.push(\`\${key} IS NULL\`);
        }
      }

      if (wheres.length > 0) sql += ' WHERE ' + wheres.join(' AND ');
      if (params.order) {
        const [col, dir] = params.order.split('.');
        sql += \` ORDER BY \${col} \${dir.toUpperCase()}\`;
      }
      if (params.limit) {
        values.push(parseInt(params.limit));
        sql += \` LIMIT $\${values.length}\`;
      }
    } else if (method === 'POST') {
      const isArray = Array.isArray(body);
      const items = isArray ? body : [body];
      if (items.length === 0) return [];
      
      const keys = Object.keys(items[0]);
      const columns = keys.join(', ');
      const rows = [];
      
      items.forEach(item => {
        const row = keys.map(k => {
          let val = item[k];
          if (Array.isArray(val) || (val && typeof val === 'object')) { val = JSON.stringify(val); }
          values.push(val);
          return \`$\${values.length}\`;
        });
        rows.push(\`(\${row.join(', ')})\`);
      });
      
      sql = \`INSERT INTO \${table} (\${columns}) VALUES \${rows.join(', ')}\`;
      if (params.on_conflict) {
        sql += \` ON CONFLICT (\${params.on_conflict}) DO UPDATE SET \`;
        const updates = keys.filter(k => !params.on_conflict.split(',').includes(k)).map(k => \`\${k} = EXCLUDED.\${k}\`);
        if (updates.length > 0) {
           sql += updates.join(', ');
        } else {
           sql = sql.replace(\`ON CONFLICT (\${params.on_conflict}) DO UPDATE SET \`, \`ON CONFLICT (\${params.on_conflict}) DO NOTHING\`);
        }
      }
      if (options.headers && options.headers.Prefer && options.headers.Prefer.includes('return=representation')) {
         sql += ' RETURNING *';
      }
    } else if (method === 'PATCH') {
      const keys = Object.keys(body);
      const sets = keys.map(k => {
        let val = body[k];
        if (Array.isArray(val) || (val && typeof val === 'object')) { val = JSON.stringify(val); }
        values.push(val);
        return \`\${k} = $\${values.length}\`;
      });
      sql = \`UPDATE \${table} SET \${sets.join(', ')}\`;
      
      const wheres = [];
      for (const [key, val] of Object.entries(params)) {
        if (key === 'on_conflict' || key === 'select' || key === 'order' || key === 'limit') continue;
        const [op, ...rest] = val.split('.');
        const v = rest.join('.');
        if (op === 'eq') { values.push(v); wheres.push(\`\${key} = $\${values.length}\`); }
        else if (op === 'is' && v === 'null') { wheres.push(\`\${key} IS NULL\`); }
      }
      if (wheres.length > 0) sql += ' WHERE ' + wheres.join(' AND ');
      
      if (options.headers && options.headers.Prefer && options.headers.Prefer.includes('return=representation')) {
         sql += ' RETURNING *';
      }
    } else if (method === 'DELETE') {
      sql = \`DELETE FROM \${table}\`;
      const wheres = [];
      for (const [key, val] of Object.entries(params)) {
        const [op, ...rest] = val.split('.');
        const v = rest.join('.');
        if (op === 'eq') { values.push(v); wheres.push(\`\${key} = $\${values.length}\`); }
        if (op === 'lt') { values.push(v); wheres.push(\`\${key} < $\${values.length}\`); }
        if (op === 'in') {
          const list = v.substring(1, val.length - 1).split(',');
          const placeholders = list.map(item => {
            values.push(item);
            return \`$\${values.length}\`;
          }).join(',');
          wheres.push(\`\${key} IN (\${placeholders})\`);
        }
      }
      if (wheres.length > 0) sql += ' WHERE ' + wheres.join(' AND ');
    }

    const res = await query(sql, values);
    return res.rows;
  }

  async function rpc(functionName, body) {
    const keys = Object.keys(body || {});
    const values = [];
    const args = keys.map((k) => {
       let val = body[k];
       if (Array.isArray(val) || (val && typeof val === 'object')) { val = JSON.stringify(val); }
       values.push(val);
       return \`\${k} := $\${values.length}\`;
    });
    const sql = \`SELECT * FROM \${functionName}(\${args.join(', ')})\`;
    const res = await query(sql, values);
    return res.rows;
  }
`;

const lines = content.split('\n'); 
const startIdx = lines.findIndex(l => l.includes('function mapUserFromRow(row) {')); 
const newContent = newTop + '\n' + lines.slice(startIdx).join('\n'); 
fs.writeFileSync('src/repositories/postgresRepositories.js', newContent); 
console.log('Successfully replaced postgres wrapper with built-in pg proxy.');
