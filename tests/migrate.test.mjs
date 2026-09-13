import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getMigrationFiles,
  getAppliedMigrations,
  runMigrations,
  loadLocalEnv,
  execSql,
} from '../scripts/migrate.mjs';

loadLocalEnv();
const DB_URL = process.env.DATABASE_URL;

test('package.json includes migrate script', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.strictEqual(pkg.scripts.migrate, 'node scripts/migrate.mjs');
});

test('migrations directory exists and contains expected SQL files', () => {
  const dir = resolve(process.cwd(), 'migrations');
  assert.strictEqual(existsSync(dir), true, 'migrations directory must exist');

  const files = getMigrationFiles(dir);
  assert(files.length >= 4, `expected at least 4 migration files, got ${files.length}`);
  assert.strictEqual(files[0], '001_initial_rate_limits.sql');
  assert.strictEqual(files[1], '002_update_rate_limit_per_ip_all_endpoints.sql');
  assert.strictEqual(files[2], '003_remove_unused_tables.sql');
  assert.strictEqual(files[3], '004_drop_redundant_rpm_column.sql');
});

test('migration files contain valid rate limit statements', () => {
  const m1 = readFileSync('migrations/001_initial_rate_limits.sql', 'utf8');
  assert(m1.includes('CREATE TABLE IF NOT EXISTS endpoint_rate_limits'));
  assert(m1.includes('CREATE TABLE IF NOT EXISTS client_ip_requests'));

  const m2 = readFileSync('migrations/002_update_rate_limit_per_ip_all_endpoints.sql', 'utf8');
  assert(m2.includes('rate_limit_per_ip'));
  assert(m2.includes('UPDATE endpoint_rate_limits'));

  const m3 = readFileSync('migrations/003_remove_unused_tables.sql', 'utf8');
  assert(m3.includes('DROP TABLE IF EXISTS client_ip_requests'));
  assert(m3.includes('chk_requests_per_minute_positive'));
  assert(m3.includes('trg_endpoint_rate_limits_updated_at'));

  const m4 = readFileSync('migrations/004_drop_redundant_rpm_column.sql', 'utf8');
  assert(m4.includes('DROP COLUMN IF EXISTS requests_per_minute'));
});

test('runMigrations connects, skips already applied migrations, and stores state in DB table', async () => {
  if (!DB_URL) {
    return; // Skip DB integration test if no DATABASE_URL configured
  }

  const testTable = `test_runner_migrations_${Date.now()}`;
  
  // Custom silent logger to capture output
  const logs = [];
  const testLogger = {
    log: msg => logs.push(String(msg)),
    error: msg => logs.push(String(msg)),
  };

  try {
    // Run first time on dedicated test table
    const res1 = await runMigrations({
      databaseUrl: DB_URL,
      tableName: testTable,
      logger: testLogger,
    });

    assert(res1.applied.length >= 4, 'should apply migrations to test table');

    // Verify recorded state in database
    const applied = await getAppliedMigrations(DB_URL, testTable);
    assert(applied.has('001_initial_rate_limits.sql'));
    assert(applied.has('002_update_rate_limit_per_ip_all_endpoints.sql'));
    assert(applied.has('003_remove_unused_tables.sql'));
    assert(applied.has('004_drop_redundant_rpm_column.sql'));

    // Run second time on same test table -> must skip all already applied migrations
    const res2 = await runMigrations({
      databaseUrl: DB_URL,
      tableName: testTable,
      logger: testLogger,
    });

    assert.strictEqual(res2.applied.length, 0, 'should not rerun any migrations');
    assert(res2.skipped.includes('001_initial_rate_limits.sql'));
    assert(res2.skipped.includes('002_update_rate_limit_per_ip_all_endpoints.sql'));
    assert(res2.skipped.includes('003_remove_unused_tables.sql'));
    assert(res2.skipped.includes('004_drop_redundant_rpm_column.sql'));
  } finally {
    try {
      await execSql(DB_URL, `DROP TABLE IF EXISTS ${testTable};`);
    } catch {
      // ignore cleanup errors
    }
  }
});
