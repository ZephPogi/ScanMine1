const { Pool } = require('pg');
require('dotenv').config({ path: './server/.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function check() {
  try {
    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log('Tables:', res.rows.map(r => r.table_name));

    const res2 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
    console.log('Users Columns:', res2.rows.map(r => r.column_name));

    await pool.end();
  } catch (e) {
    console.error(e);
  }
}
check();
