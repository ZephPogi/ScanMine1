const db = require('./db');
async function check() {
  const res = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'student_submissions'");
  console.log('Student_Submissions Columns:', res.rows.map(r => r.column_name));
  process.exit(0);
}
check();
