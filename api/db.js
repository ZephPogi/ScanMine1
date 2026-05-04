const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Use Supabase connection string if available, otherwise fall back to individual params
const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;

const pool = new Pool(connectionString
  ? { connectionString }
  : {
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
    }
);

// Handle connection errors
pool.on('error', (err) => {
  console.error('Unexpected database connection error:', err);
  // Don't crash the process, just log the error
});

module.exports = {
  query: async (text, params) => {
    try {
      return await pool.query(text, params);
    } catch (err) {
      console.error('Database query error:', err);
      throw err;
    }
  },
};
