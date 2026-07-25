const db = require('./db');
async function run() {
    try {
        const users = await db.query("SELECT id, name, role FROM Users");
        console.log("USERS:", users.rows);
        const students = await db.query("SELECT * FROM Students");
        console.log("STUDENTS (Link table):", students.rows);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
run();
