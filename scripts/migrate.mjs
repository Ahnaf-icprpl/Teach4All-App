import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

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
 * Execute SQL statements using psql.
 */
export function execSql(databaseUrl, sql, { queryOnly = false } = {}) {
  const args = [
    databaseUrl,
    '-v', 'ON_ERROR_STOP=1',
    '-X',
    '-q',
  ];

  if (queryOnly) {
    args.push('-t', '-A', '-c', sql);
    return execFileSync('psql', args, {
      encoding: 'utf8',
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  }

  return execFileSync('psql', args, {
    input: sql,
    encoding: 'utf8',
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Initialize migration tracking table if not exists.
 */
export function initMigrationsTable(databaseUrl, tableName = 'teach4all_migrations') {
  const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS ${sanitizedTable} (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  execSql(databaseUrl, createTableSql);
}

/**
 * Fetch list of already executed migration file names from DB table.
 */
export function getAppliedMigrations(databaseUrl, tableName = 'teach4all_migrations') {
  const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  initMigrationsTable(databaseUrl, sanitizedTable);
  const raw = execSql(databaseUrl, `SELECT name FROM ${sanitizedTable} ORDER BY id ASC;`, { queryOnly: true });
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
export function runMigrations({
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

  initMigrationsTable(databaseUrl, sanitizedTable);
  const appliedSet = getAppliedMigrations(databaseUrl, sanitizedTable);
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

    const transactionSql = `
      BEGIN;
      ${sqlContent}
      INSERT INTO ${sanitizedTable} (name) VALUES ('${file.replace(/'/g, "''")}');
      COMMIT;
    `;

    try {
      execSql(databaseUrl, transactionSql);
      applied.push(file);
      logger.log(`  [✓] APPLIED: ${file}`);
    } catch (err) {
      logger.error(`\n[!] Migration failed on file: ${file}`);
      if (err.stderr) logger.error(err.stderr.toString().trim());
      else if (err.message) logger.error(err.message);
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
}

// CLI execution entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  loadLocalEnv();
  const dbUrl = process.env.DATABASE_URL;

  try {
    runMigrations({ databaseUrl: dbUrl });
    process.exit(0);
  } catch (error) {
    console.error(`Migration error: ${error.message}`);
    process.exit(1);
  }
}
