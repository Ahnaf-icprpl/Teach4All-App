# Database Migrations Guide

Teach4All uses a lightweight, transaction-safe migration runner built directly on PostgreSQL's native driver (`pg`). All migrations are stored as version-controlled `.sql` files in the [`migrations/`](./migrations) directory, and execution state is tracked in the database inside the `teach4all_migrations` table.

---

## Architecture & How It Works

```
┌─────────────────────────┐
│       migrations/       │
│  001_initial_schema.sql │
│  002_update_limits.sql  │  ──> scripts/migrate.mjs ──> PostgreSQL Database
│  003_your_change.sql    │       (via `pg` driver)      (tracks in `teach4all_migrations`)
└─────────────────────────┘
```

1. **State Persistence**: On first run, the runner creates the `teach4all_migrations` table:
   ```sql
   CREATE TABLE IF NOT EXISTS teach4all_migrations (
       id SERIAL PRIMARY KEY,
       name VARCHAR(255) NOT NULL UNIQUE,
       applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
   );
   ```
2. **Deduplication**: Before executing any file, the runner checks `teach4all_migrations`. Files that were already executed are skipped (`[-] SKIP`).
3. **Atomic Transactions**: Every pending file is executed inside an isolated `BEGIN ... COMMIT;` transaction. If an error occurs, the transaction rolls back completely and the migration is **not** marked as applied.

---

## High Volume Strategy: PostgreSQL vs. In-Memory Separation

A critical architectural rule: **Do NOT write every single HTTP request to PostgreSQL.**

Under high volume (thousands of concurrent requests):
- **Hot-Path Isolation (In-Memory)**: Rate-limiting, IP tracking, concurrency counters, and request throttling run exclusively in-memory using local fixed window and sliding window algorithms in sub-microsecond time (`server/rateLimiter.js`). Zero SQL queries are made during HTTP request processing.
- **Fail-Safe Operation**: Rate limit policies and endpoint rules are cached in-memory with automatic TTL refresh, avoiding database latency or downtime dependency.
- **Asynchronous Batch Flusher (`BatchMetricsBuffer`)**: If request stats (`client_ip_requests`) must be preserved in PostgreSQL, requests are buffered in-memory at 0ms latency. A background worker periodically flushes the aggregated delta using a single batch multi-row UPSERT:
  ```sql
  INSERT INTO client_ip_requests (ip_address, endpoint, request_count, window_start, last_request_at)
  VALUES (...)
  ON CONFLICT (ip_address, endpoint)
  DO UPDATE SET
    request_count = client_ip_requests.request_count + EXCLUDED.request_count,
    last_request_at = EXCLUDED.last_request_at;
  ```
  This reduces 10,000 individual database writes down to **1 single database write** per flush interval (99.99% write reduction).

### High-Volume Architecture Diagram

```
[ Incoming Requests ] (10,000 req/min)
         │
         ▼
[ Fast Rate Limiter ] ─── Sub-microsecond ───> [ In-Memory Store ]
         │                                     (Atomic Map counters, 0 DB writes)
   Allowed / 429
         │
         ▼
[ In-Memory Batch Buffer ] (0ms non-blocking aggregation)
         │
         │ (Flush every 60s / 1 single batch UPSERT)
         ▼
[ PostgreSQL Database ] (`client_ip_requests`)
```

---

## Prerequisites & Environment Setup

Ensure your local `.env` contains the required connection strings:

```ini
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<database>
```

> **Security Note**: Never commit `.env` to Git. Ensure `.env` is listed in your [`.gitignore`](./.gitignore).

---

## Step-by-Step: Adding Changes to Database Structure

### Step 1: Create a New Migration File

Add a new file in the [`migrations/`](./migrations) directory. 

Follow the naming convention:
```
migrations/<seq_number>_<descriptive_action_in_snake_case>.sql
```

Examples:
- `001_initial_rate_limits.sql`
- `002_update_rate_limit_per_ip_all_endpoints.sql`
- `003_add_chat_feedback_table.sql`
- `004_add_indexes_for_conversations.sql`

*Rule*: Sequence numbers must use zero-padded 3-digit numbering (`001`, `002`, `003`, ...) to ensure chronological sorting.

---

### Step 2: Write Your SQL Statements

Write standard PostgreSQL SQL in the migration file. Follow these best practices:

#### 1. Always use defensive / idempotent DDL where possible
```sql
-- Creating tables
CREATE TABLE IF NOT EXISTS chat_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(64) NOT NULL,
    rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Adding columns
ALTER TABLE endpoint_rate_limits
ADD COLUMN IF NOT EXISTS burst_tolerance_seconds INTEGER DEFAULT 5;

-- Creating indexes
CREATE INDEX IF NOT EXISTS idx_chat_feedback_session 
ON chat_feedback (session_id, created_at);
```

#### 2. Avoid manual transaction statements inside the file
Do **not** include `BEGIN;` or `COMMIT;` inside the `.sql` file itself. The migration runner automatically wraps each file in a transaction block.

#### 3. Handle data migrations safely
If you are modifying existing columns or migrating data:
```sql
-- Step 1: Add new nullable column
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(32);

-- Step 2: Backfill existing records
UPDATE users SET status = 'active' WHERE status IS NULL;

-- Step 3: Enforce NOT NULL and defaults
ALTER TABLE users 
    ALTER COLUMN status SET DEFAULT 'active',
    ALTER COLUMN status SET NOT NULL;
```

---

### Step 3: Run the Migration

Run the migration script using npm:

```bash
npm run migrate
```

You will see output similar to:

```text
--- PostgreSQL Database Migration Runner ---
Target database: postgresql://postgres.xxxx:****@host:5432/postgres
State table:     teach4all_migrations
Migrations dir:  /path/to/Teach4All-APP/migrations
  [-] SKIP: 001_initial_rate_limits.sql (already executed)
  [-] SKIP: 002_update_rate_limit_per_ip_all_endpoints.sql (already executed)
  [+] RUNNING: 003_add_chat_feedback_table.sql...
  [✓] APPLIED: 003_add_chat_feedback_table.sql
---------------------------------------------
Migration complete! Successfully applied 1 new migration(s).
```

If you run `npm run migrate` again immediately:
```text
  [-] SKIP: 001_initial_rate_limits.sql (already executed)
  [-] SKIP: 002_update_rate_limit_per_ip_all_endpoints.sql (already executed)
  [-] SKIP: 003_add_chat_feedback_table.sql (already executed)
Database is up to date. No new migrations were needed.
```

---

### Step 4: Verify the Changes in Database

You can verify the database state directly using `psql`:

```bash
# Check applied migrations history
psql "$DATABASE_URL" -c "SELECT * FROM teach4all_migrations ORDER BY id ASC;"

# Check table schema
psql "$DATABASE_URL" -c "\d chat_feedback"
```

---

### Step 5: Run Automated Tests

Run the test suite to verify migration runner integrity and code constraints:

```bash
npm test
npm run check
```

---

## Troubleshooting & Handling Failures

### What happens when a migration fails?
Because migrations run with `ON_ERROR_STOP=1` within an atomic transaction:
1. The error message and line number are displayed in the terminal.
2. The entire SQL file is rolled back.
3. The filename is **not** written to `teach4all_migrations`.
4. Fix the syntax error or conflict in your `.sql` file, then run `npm run migrate` again.

### Rollbacks and Fixes (Fix-Forward Pattern)
In production environments, **do not delete or edit already applied migration files**. Once a migration has been applied to shared databases:
1. Create a new migration file (e.g. `004_revert_chat_feedback.sql` or `004_fix_column_type.sql`).
2. Write the corrective DDL statements.
3. Run `npm run migrate`.
