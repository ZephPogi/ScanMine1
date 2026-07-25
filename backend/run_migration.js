const fs = require('fs');
const path = require('path');
const db = require('./db');

async function runMigration() {
  try {
    const migrationPath = path.join(__dirname, 'migration_add_question_text.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    await db.query(migrationSql);
    console.log('Successfully executed migration! Added question_text column to Answer_Keys table.');
  } catch (error) {
    console.error('Error executing migration:', error);
  }
}

runMigration();
