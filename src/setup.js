/**
 * Setup script: initializes DB schema and creates admin user.
 * Run once: node src/setup.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('./db');

async function setup() {
  console.log('🔧 Running Libérrima DB setup...');

  // Run schema
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✅ Schema created.');

  // Create admin user
  // TEMP: use pre-computed hash to ensure correct password regardless of env var
  const email = process.env.ADMIN_EMAIL || 'culturaliberrima@gmail.com';
  // Hash of 'Liberrima2026' — pre-computed to avoid env var dependency
  const hash = '$2a$12$I9teSCYeiZUC3YBAVjAefeB0IKq9BgjS4myT2yvIdVB0R79W0B9s.';
  await pool.query(
    `INSERT INTO users (email, password) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password = $2`,
    [email, hash]
  );
  console.log(`✅ Admin user ready: ${email}`);

  await pool.end();
  console.log('🎉 Setup complete.');
}

setup().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
