const { Pool } = require('pg');
require('dotenv').config({ path: './server/.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function check() {
  try {
    const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'student_submissions'");
    console.log('Student_Submissions Columns:', res.rows);
    
    const res2 = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'students'");
    console.log('Students Columns:', res2.rows);

    await pool.end();
  } catch (e) {
    console.error(e);
  }
}
check();
