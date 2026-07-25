const db = require('./db');
async function check() {
  const res = await db.query("SELECT id, title FROM Exams");
  console.log('All Exams:', res.rows);
  process.exit(0);
}
check();
