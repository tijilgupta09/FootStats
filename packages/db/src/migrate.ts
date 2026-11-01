import * as fs from 'fs';
import * as path from 'path';
import { getPool, closePool } from './connection';
import 'dotenv/config';

async function migrate(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Get already-executed migrations
    const result = await client.query('SELECT name FROM _migrations ORDER BY id');
    const executed = new Set(result.rows.map((r: { name: string }) => r.name));

    // Read migration files
    const migrationsDir = path.resolve(__dirname, '..', 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let applied = 0;
    for (const file of files) {
      if (executed.has(file)) {
        console.log(`[MIGRATE] Skipping (already applied): ${file}`);
        continue;
      }

      console.log(`[MIGRATE] Applying: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[MIGRATE] ✓ Applied: ${file}`);
        applied++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[MIGRATE] ✗ Failed: ${file}`, err);
        throw err;
      }
    }

    if (applied === 0) {
      console.log('[MIGRATE] All migrations are up to date.');
    } else {
      console.log(`[MIGRATE] Applied ${applied} migration(s).`);
    }
  } finally {
    client.release();
    await closePool();
  }
}

migrate().catch((err) => {
  console.error('[MIGRATE] Migration failed:', err);
  process.exit(1);
});
