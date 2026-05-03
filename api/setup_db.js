const fs = require('fs');
const path = require('path');
const db = require('./db');

async function setup() {
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await db.query(schemaSql);
    console.log('Successfully executed schema.sql on the database!');
  } catch (error) {
    console.error('Error executing schema.sql:', error);
  }
}

setup();
