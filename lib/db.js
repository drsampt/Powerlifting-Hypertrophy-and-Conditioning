const { Pool, types } = require('pg');

// pg returns NUMERIC (oid 1700) as strings by default; our analytics/adjustment
// math needs real numbers.
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
