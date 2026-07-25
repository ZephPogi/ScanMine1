const db = require('./db');
async function check() {
  const res = await db.query("SELECT * FROM Rules");
  console.log('Rules:', res.rows);
  process.exit(0);
}
check();
