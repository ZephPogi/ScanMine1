const db = require('./db');
async function check() {
  const res = await db.query("SELECT * FROM Generated_Questions");
  console.log('Total Generated Questions:', res.rows.length);
  const res2 = await db.query("SELECT * FROM Answer_Keys");
  console.log('Total Answer Keys:', res2.rows.length);
  process.exit(0);
}
check();
