const { Pool } = require('pg');

// Only load dotenv if we are not on Vercel/Production
// Vercel handles environment variables internally.
if (process.env.NODE_ENV !== 'production') {
  const path = require('path');
  require('dotenv').config();
}

// Use the connection string provided in your Vercel Environment Variables.
const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;

const pool = new Pool({
  connectionString,
  // CRITICAL: Supabase requires SSL for external connections from Vercel.
  ssl: {
    rejectUnauthorized: false
  }
});

// Log any unexpected errors to the Vercel Function logs.
pool.on('error', (err) => {
  console.error('Unexpected database connection error:', err);
});

module.exports = {
  /**
   * Helper function for executing SQL queries.
   * @param {string} text - The SQL query string.
   * @param {Array} params - The parameters for the query.
   */
  query: async (text, params) => {
    try {
      return await pool.query(text, params);
    } catch (err) {
      console.error('Database query execution error:', err);
      throw err;
    }
  },
};