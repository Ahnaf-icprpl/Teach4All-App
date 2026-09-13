import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;

/**
 * Minimal environment loader for .env files without external dependencies.
 */
export function loadLocalEnv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

/**
 * Determine SSL config from database URL.
 */
export function getSslConfig(connectionString) {
  if (!connectionString) return false;
  const isLocalhost = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  if (isLocalhost && !connectionString.includes('sslmode=require')) {
    return false;
  }
  return { rejectUnauthorized: false };
}

/**
 * Create and connect a pg Client.
 */
export async function createClient(databaseUrl) {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: getSslConfig(databaseUrl),
  });
  await client.connect();
  return client;
}

/**
 * Execute SQL statements using pg driver.
 */
export async function execSql(databaseUrl, sql, { queryOnly = false } = {}) {
  const client = await createClient(databaseUrl);
  try {
    const res = await client.query(sql);
    if (queryOnly) {
      if (Array.isArray(res)) {
        return res
          .map(r => (r.rows || []).map(row => Object.values(row).join('|')).join('\n'))
          .filter(Boolean)
          .join('\n')
          .trim();
      }
      if (res && res.rows && res.rows.length > 0) {
        return res.rows.map(row => Object.values(row).join('|')).join('\n').trim();
      }
      return '';
    }
    return res;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Initialize migration tracking table if not exists.
 */
export async function initMigrationsTable(databaseUrl, tableName = 'teach4all_migrations', client = null) {
  const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS ${sanitizedTable} (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  if (client) {
    await client.query(createTableSql);
  } else {
    await execSql(databaseUrl, createTableSql);
  }
}

/**
 * Fetch list of already executed migration file names from DB table.
 */
export async function getAppliedMigrations(databaseUrl, tableName = 'teach4all_migrations', client = null) {
  const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  await initMigrationsTable(databaseUrl, sanitizedTable, client);
  if (client) {
    const res = await client.query(`SELECT name FROM ${sanitizedTable} ORDER BY id ASC;`);
    return new Set(res.rows.map(r => r.name.trim()).filter(Boolean));
  }
  const raw = await execSql(databaseUrl, `SELECT name FROM ${sanitizedTable} ORDER BY id ASC;`, { queryOnly: true });
  if (!raw) return new Set();
  return new Set(raw.split('\n').map(s => s.trim()).filter(Boolean));
}

/**
 * Retrieve sorted list of migration .sql files from directory.
 */
export function getMigrationFiles(migrationsDir) {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir)
    .filter(name => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/**
 * Execute pending migrations sequentially inside database transactions.
 * Skips already run migrations and stores state in a DB table.
 */
export async function runMigrations({
  databaseUrl = process.env.DATABASE_URL,
  migrationsDir = resolve(process.cwd(), 'migrations'),
  tableName = process.env.MIGRATIONS_TABLE || 'teach4all_migrations',
  logger = console,
} = {}) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not defined.');
  }

  const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');

  logger.log('--- PostgreSQL Database Migration Runner ---');
  logger.log(`Target database: ${databaseUrl.replace(/:[^:@]+@/, ':****@')}`);
  logger.log(`State table:     ${sanitizedTable}`);
  logger.log(`Migrations dir:  ${migrationsDir}`);

  const client = await createClient(databaseUrl);
  try {
    await initMigrationsTable(databaseUrl, sanitizedTable, client);
    const appliedSet = await getAppliedMigrations(databaseUrl, sanitizedTable, client);
    const files = getMigrationFiles(migrationsDir);

    if (files.length === 0) {
      logger.log('No migration files found in migrations directory.');
      return { applied: [], skipped: [], total: 0 };
    }

    const applied = [];
    const skipped = [];

    for (const file of files) {
      if (appliedSet.has(file)) {
        skipped.push(file);
        logger.log(`  [-] SKIP: ${file} (already executed)`);
        continue;
      }

      logger.log(`  [+] RUNNING: ${file}...`);
      const filePath = join(migrationsDir, file);
      const sqlContent = readFileSync(filePath, 'utf8');

      try {
        await client.query('BEGIN');
        await client.query(sqlContent);
        await client.query(`INSERT INTO ${sanitizedTable} (name) VALUES ($1);`, [file]);
        await client.query('COMMIT');
        applied.push(file);
        logger.log(`  [✓] APPLIED: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error(`\n[!] Migration failed on file: ${file}`);
        if (err.message) logger.error(err.message);
        throw err;
      }
    }

    logger.log('---------------------------------------------');
    if (applied.length > 0) {
      logger.log(`Migration complete! Successfully applied ${applied.length} new migration(s).`);
    } else {
      logger.log('Database is up to date. No new migrations were needed.');
    }

    return { applied, skipped, total: files.length };
  } finally {
    await client.end().catch(() => {});
  }
}

// CLI execution entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  loadLocalEnv();
  const dbUrl = process.env.DATABASE_URL;

  runMigrations({ databaseUrl: dbUrl })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`Migration error: ${error.message}`);
      process.exit(1);
    });
}
