const db = require('./db');

async function check() {
  try {
    const res = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log('Tables:', res.rows.map(r => r.table_name));

    const res2 = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
    console.log('Users Columns:', res2.rows.map(r => r.column_name));
    
    // Check Students table if it exists
    const hasStudents = res.rows.some(r => r.table_name === 'students');
    if (hasStudents) {
        const res3 = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'students'");
        console.log('Students Columns:', res3.rows.map(r => r.column_name));
    }

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
check();
