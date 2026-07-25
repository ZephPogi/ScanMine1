const db = require('./db');
async function check() {
  try {
    const res = await db.query("SELECT id, title FROM Exams WHERE title ILIKE '%General%'");
    console.log('Exams found:', res.rows);
    if (res.rows.length > 0) {
      const examId = res.rows[0].id;
      const keys = await db.query("SELECT * FROM Answer_Keys WHERE exam_id = $1", [examId]);
      console.log('Manual Keys:', keys.rows.length);
      const gens = await db.query("SELECT * FROM Generated_Questions WHERE exam_id = $1", [examId]);
      console.log('Generated Questions:', gens.rows.length);
    }
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
check();
