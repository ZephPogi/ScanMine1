const db = require('../db');
const bcrypt = require('bcrypt');

async function check() {
  try {
    const tableRes = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'exams'
    `);
    console.log('Columns:', tableRes.rows);

    const userRes = await db.query('SELECT * FROM Users LIMIT 1');
    if (userRes.rows.length > 0) {
      const user = userRes.rows[0];
      console.log('Sample User:', { id: user.id, email: user.email, role: user.role });
      console.log('Hash length:', user.password_hash ? user.password_hash.length : 'NULL');
    } else {
      console.log('No users found');
    }
  } catch (e) {
    console.error('Error during check:', e);
  } finally {
    process.exit();
  }
}

check();
