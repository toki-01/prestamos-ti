const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

(async () => {
  for (const f of ['schema.sql', 'schema_extra.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    await pool.query(sql);
    console.log('Aplicado:', f);
  }
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
