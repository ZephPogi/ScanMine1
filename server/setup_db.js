const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function setup() {
  try {
    const schemaSql = fs.readFileSync('schema.sql', 'utf8');
    await pool.query(schemaSql);
    console.log('Successfully executed schema.sql on the database!');
  } catch (error) {
    console.error('Error executing schema.sql:', error);
  } finally {
    pool.end();
  }
}

setup();
