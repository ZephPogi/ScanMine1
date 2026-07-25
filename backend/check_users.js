const db = require('./db');
async function checkUsers() {
  try {
    const res = await db.query('SELECT * FROM Users');
    console.log("Users in DB:");
    console.log(res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
checkUsers();
