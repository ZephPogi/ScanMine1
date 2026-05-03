const db = require('./db');
async function check() {
  const res = await db.query("SELECT id, title, raw_text_content FROM Exams WHERE title = 'tHESIS 3'");
  console.log('Exam Data:', res.rows[0]);
  process.exit(0);
}
check();
