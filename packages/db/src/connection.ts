import { Pool, type PoolConfig } from 'pg';

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  maxConnections?: number;
}

function getConfig(): DbConfig {
  return {
    host: process.env['DATABASE_HOST'] ?? 'localhost',
    port: parseInt(process.env['DATABASE_PORT'] ?? '5432', 10),
    database: process.env['DATABASE_NAME'] ?? 'footstats',
    user: process.env['DATABASE_USER'] ?? 'footstats',
    password: process.env['DATABASE_PASSWORD'] ?? 'footstats_dev',
    ssl: process.env['DATABASE_SSL'] === 'true',
    maxConnections: parseInt(process.env['DATABASE_MAX_CONNECTIONS'] ?? '20', 10),
  };
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const config = getConfig();
    const poolConfig: PoolConfig = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.maxConnections,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    };
    pool = new Pool(poolConfig);

    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error:', err.message);
    });

    pool.on('connect', () => {
      console.log('[DB] New client connected');
    });
  }
  return pool;
}

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const client = await getPool().connect();
  try {
    const result = await client.query(text, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

export async function queryOne<T>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function transaction<T>(
  fn: (client: import('pg').PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[DB] Pool closed');
  }
}
