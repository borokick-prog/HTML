const { Pool } = require('pg');

// Vercel's Postgres marketplace integrations (Supabase, Neon) name the
// connection string POSTGRES_URL rather than DATABASE_URL, so accept either.
// Prefer the pooled variant when a provider exposes both.
const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  throw new Error(
    'No Postgres connection string found. Set DATABASE_URL (or connect a Postgres integration that provides POSTGRES_URL) in your environment variables.'
  );
}

// Local/self-hosted Postgres typically doesn't use TLS; managed providers
// (Neon, Supabase, Railway, Vercel Postgres) require it.
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

let schemaReady = null;

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS folders (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        original_filename TEXT,
        folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
        password_hash TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);
    `);
  }
  return schemaReady;
}

async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : undefined;
}

async function setSetting(key, value) {
  await pool.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

module.exports = { pool, ensureSchema, getSetting, setSetting };
