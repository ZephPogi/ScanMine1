const fs = require('fs');
const path = require('path');
const db = require('./db');

async function runMigration() {
  const migrationFiles = [
    'migration_add_question_text.sql',
    'migration_add_is_verified.sql'
  ];

  for (const migrationFile of migrationFiles) {
    try {
      const migrationPath = path.join(__dirname, migrationFile);
      const migrationSql = fs.readFileSync(migrationPath, 'utf8');
      await db.query(migrationSql);
      console.log(`Successfully executed migration: ${migrationFile}`);
    } catch (error) {
      console.error(`Error executing migration ${migrationFile}:`, error);
    }
  }
}

runMigration();
