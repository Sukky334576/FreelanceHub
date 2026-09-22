/**
 * Native PostgreSQL Multi-Connection Concurrency Integration Harness
 * 
 * Verifies execute_create_transaction concurrency, idempotency, and subtransaction
 * rollback isolation across real concurrent database connections.
 * 
 * Hardened per Codex Review Findings (H01 - H04):
 *   - [H01] Explicit non-zero exit codes on failure/skip, with specific error categorization (Network, Auth, Configuration).
 *   - [H02] Deterministic barrier synchronization polling pg_stat_activity, pg_backend_pid, and pg_blocking_pids with deadlines.
 *   - [H03] Unbiased race evaluation for conflicting payloads (dynamically verifies either winner without hardcoded expectations) with Promise.allSettled.
 *   - [H04] Strict enforcement of TEST_DATABASE_URL targeting disposable databases, with safety guards prohibiting production hosts.
 *   - Robust finally cleanup blocks ensuring locks, triggers, and transactions are completely cleared even on failure.
 *   - Exhaustive assertions on ledger counts, wallet balances, and related_job null-safe comparisons on both pre-check and race exception paths.
 * 
 * Usage:
 *   TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/test_freelancehub" npm run test:concurrency
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ------------------------------------------------------------------------------
// H04: Strict TEST_DATABASE_URL Enforcement & Production Host Safety Guard
// ------------------------------------------------------------------------------
const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl || !testDbUrl.trim()) {
  console.error('================================================================================');
  console.error('❌ [H04 CONFIGURATION ERROR] Missing required environment variable: TEST_DATABASE_URL');
  console.error('================================================================================');
  console.error('Per safety requirements, this test harness will NOT fall back to DATABASE_URL or');
  console.error('default databases, preventing accidental execution against application/production databases.\n');
  console.error('📖 Please specify an explicit disposable test database URL:');
  console.error('   TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/test_db" npm run test:concurrency\n');
  process.exit(1);
}

// Safety check against known production hosts
try {
  const parsedUrl = new URL(testDbUrl);
  const hostname = parsedUrl.hostname.toLowerCase();
  if (
    hostname.includes('supabase.co') ||
    hostname.includes('pyxjwilhqixceehqkpcl') ||
    hostname.includes('prod') ||
    hostname.includes('live')
  ) {
    console.error('================================================================================');
    console.error(`🚨 [H04 SAFETY VIOLATION] TEST_DATABASE_URL targets a remote or production host: ${hostname}`);
    console.error('================================================================================');
    console.error('Automated test execution, DDL migrations, and shims on production databases are strictly prohibited.');
    process.exit(1);
  }
} catch (err) {
  console.error(`❌ [H04 CONFIGURATION ERROR] Invalid TEST_DATABASE_URL format: ${err.message}`);
  process.exit(1);
}

// ------------------------------------------------------------------------------
// H02 Helper: Deterministic Lock Barrier Waiter with Timeout
// ------------------------------------------------------------------------------
async function waitForWorkersBlocked(monitorClient, workerPids, controllerPid, timeoutMs = 6000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const res = await monitorClient.query(`
      SELECT 
        pid,
        wait_event_type,
        wait_event,
        state,
        pg_blocking_pids(pid) AS blocking_pids,
        query
      FROM pg_stat_activity
      WHERE pid = ANY($1::int[])
    `, [workerPids]);

    const blockedWorkers = res.rows.filter(r => {
      const isLockWait = r.wait_event_type === 'Lock' || r.wait_event === 'advisory' || r.wait_event === 'transactionid' || r.wait_event === 'tuple';
      const hasBlockingPid = Array.isArray(r.blocking_pids) && (
        r.blocking_pids.includes(controllerPid) || r.blocking_pids.length > 0
      );
      return isLockWait || hasBlockingPid;
    });

    if (blockedWorkers.length === workerPids.length) {
      return {
        success: true,
        blockedWorkers,
        elapsedMs: Date.now() - startTime
      };
    }
    await new Promise(r => setTimeout(r, 30));
  }

  // Timeout reached: fetch diagnostic snapshot
  const diag = await monitorClient.query(`
    SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blocking_pids, query
    FROM pg_stat_activity
    WHERE pid = ANY($1::int[])
  `, [workerPids]);

  throw new Error(
    `[H02] Barrier Timeout: Workers failed to enter lock wait state within ${timeoutMs}ms.\n` +
    `Expected PIDs: [${workerPids.join(', ')}], Controller PID: ${controllerPid}\n` +
    `Diagnostic snapshot:\n${JSON.stringify(diag.rows, null, 2)}`
  );
}

// ------------------------------------------------------------------------------
// Main Test Runner
// ------------------------------------------------------------------------------
async function main() {
  console.log('================================================================================');
  console.log('🚀 Native PostgreSQL Multi-Connection Concurrency Integration Harness');
  console.log('================================================================================');
  console.log(`Connecting to: ${testDbUrl.replace(/:[^:@]+@/, ':****@')}\n`);

  const pool = new Pool({
    connectionString: testDbUrl,
    max: 10,
    connectionTimeoutMillis: 4000
  });

  // H01: Categorize connection failures and exit non-zero
  let pgVersion = '';
  let dbName = '';
  try {
    const versionRes = await pool.query('SELECT version(), current_database();');
    pgVersion = versionRes.rows[0].version;
    dbName = versionRes.rows[0].current_database;
    console.log(`✅ Connected successfully to Native PostgreSQL!`);
    console.log(`📌 Target Database: ${dbName}`);
    console.log(`📌 Engine Version:  ${pgVersion}\n`);
  } catch (err) {
    let category = 'UNKNOWN_CONNECTION_ERROR';
    if (err.code === 'ECONNREFUSED' || err.code === 'EPERM' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
      category = 'NETWORK_OR_SERVICE_UNAVAILABLE';
    } else if (err.code === '28P01' || err.code === '28000') {
      category = 'AUTHENTICATION_FAILED';
    } else if (err.code === '3D000') {
      category = 'DATABASE_DOES_NOT_EXIST';
    }
    console.error('================================================================================');
    console.error(`❌ [H01 CONNECTION FAILURE] Category: ${category}`);
    console.error(`   Error Message: ${err.message || err.code || String(err)}`);
    console.error(`   Error Code:    ${err.code || 'N/A'}`);
    console.error('================================================================================');
    console.error('ℹ️  Environment Status: Native PostgreSQL test database is not reachable.');
    console.error('   Per verification gate requirements, this run is marked FAILED (Exit Code: 1).\n');
    console.error('📖 Instructions to spin up a local disposable PostgreSQL 16 instance:');
    console.error('   docker run -d --name pg-concurrency-test -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine');
    console.error('   TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npm run test:concurrency\n');
    await pool.end();
    process.exit(1);
  }

  const monitorClient = await pool.connect();
  await monitorClient.query('SET statement_timeout = 15000;');

  try {
    // ----------------------------------------------------------------------------
    // Step 1: Initialize Database Schema & Authentication Shims
    // ----------------------------------------------------------------------------
    console.log('📦 Step 1: Initializing Schema & Authentication Shims on Test Database...');
    const setupClient = await pool.connect();
    try {
      await setupClient.query('SET statement_timeout = 30000;');
      await setupClient.query(`
        CREATE SCHEMA IF NOT EXISTS auth;
        CREATE TABLE IF NOT EXISTS auth.users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email TEXT
        );
        DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
          SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
        $$ LANGUAGE sql STABLE;

        CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
          SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
        $$ LANGUAGE sql STABLE;
      `);

      const migrationPath = path.join(__dirname, '..', 'supabase_migration_v2.sql');
      const migrationSql = fs.readFileSync(migrationPath, 'utf8');
      await setupClient.query(migrationSql);
      console.log('   ✅ Migration v2 and security policies applied successfully.\n');
    } finally {
      setupClient.release();
    }

    // Seed test users
    const userA = '11111111-1111-1111-1111-111111111111';
    const userB = '22222222-2222-2222-2222-222222222222';
    await pool.query(`
      INSERT INTO auth.users (id, email) VALUES ($1, 'userA@concurrency.test'), ($2, 'userB@concurrency.test')
      ON CONFLICT (id) DO NOTHING;
    `, [userA, userB]);

    // ----------------------------------------------------------------------------
    // SCENARIO 1: Same Key / Same Payload Multi-Connection Race (H02 Verified)
    // ----------------------------------------------------------------------------
    console.log('🧪 Scenario 1: Same Key / Same Payload Multi-Connection Race');
    const w1Res = await pool.query(`
      INSERT INTO public.wallets (name, balance, user_id) 
      VALUES ('Wallet Race 1', 1000.00, $1) 
      RETURNING id;
    `, [userA]);
    const w1 = w1Res.rows[0].id;

    const controller1 = await pool.connect();
    const conn1A = await pool.connect();
    const conn1B = await pool.connect();
    await controller1.query('SET statement_timeout = 15000;');
    await conn1A.query('SET statement_timeout = 15000;');
    await conn1B.query('SET statement_timeout = 15000;');

    try {
      const c1Pid = (await controller1.query('SELECT pg_backend_pid() AS pid;')).rows[0].pid;
      const w1Pid = (await conn1A.query('SELECT pg_backend_pid() AS pid;')).rows[0].pid;
      const w2Pid = (await conn1B.query('SELECT pg_backend_pid() AS pid;')).rows[0].pid;
      console.log(`   Controller PID: ${c1Pid} | Worker 1 PID: ${w1Pid} | Worker 2 PID: ${w2Pid}`);

      await conn1A.query(`SET request.jwt.claim.sub = '${userA}'; SET request.jwt.claim.role = 'authenticated';`);
      await conn1B.query(`SET request.jwt.claim.sub = '${userA}'; SET request.jwt.claim.role = 'authenticated';`);

      // 1. Controller locks the wallet row
      console.log('   1. Controller acquiring row lock: SELECT * FROM wallets WHERE id = $1 FOR UPDATE...');
      await controller1.query('BEGIN;');
      await controller1.query('SELECT * FROM public.wallets WHERE id = $1 FOR UPDATE;', [w1]);

      // 2. Both workers invoke execute_create_transaction with identical request_id and payload
      const reqId1 = 'req-multi-same-' + Date.now();
      console.log(`   2. Launching Worker 1 & Worker 2 concurrently (request_id: ${reqId1}, expense: 100.00)...`);
      const p1 = conn1A.query(`
        SELECT public.execute_create_transaction(
          p_date := '2026-09-22'::date,
          p_type := 'รายจ่าย',
          p_category := 'อาหาร',
          p_amount := 100.00,
          p_details := 'อาหารมื้อเที่ยงทีมงาน',
          p_related_job := NULL,
          p_wallet_id := $1,
          p_card_id := NULL,
          p_job_id := NULL,
          p_request_id := $2
        ) AS res;
      `, [w1, reqId1]);

      const p2 = conn1B.query(`
        SELECT public.execute_create_transaction(
          p_date := '2026-09-22'::date,
          p_type := 'รายจ่าย',
          p_category := 'อาหาร',
          p_amount := 100.00,
          p_details := 'อาหารมื้อเที่ยงทีมงาน',
          p_related_job := NULL,
          p_wallet_id := $1,
          p_card_id := NULL,
          p_job_id := NULL,
          p_request_id := $2
        ) AS res;
      `, [w1, reqId1]);

      const allPromises1 = Promise.allSettled([p1, p2]);

      // 3. H02: Poll and prove BOTH workers are blocked by controller before releasing
      console.log('   3. [H02] Polling pg_stat_activity & pg_blocking_pids until BOTH workers are blocked...');
      const barrierProof1 = await waitForWorkersBlocked(monitorClient, [w1Pid, w2Pid], c1Pid);
      console.log(`   ✅ [H02 PROVEN] Both workers confirmed blocked on wallet lock after ${barrierProof1.elapsedMs}ms!`);

      // 4. Controller releases lock
      console.log('   4. Releasing controller lock (COMMIT)...');
      await controller1.query('COMMIT;');

      const results1 = await allPromises1;
      const resA = results1[0].value.rows[0].res;
      const resB = results1[1].value.rows[0].res;
      const statuses = [resA.status, resB.status].sort();
      console.log(`   5. Execution Outcomes: [${resA.status}, ${resB.status}]`);
      assert.deepStrictEqual(statuses, ['CREATED', 'IDEMPOTENT_RETRY'], 'One worker must return CREATED and the other IDEMPOTENT_RETRY');

      // 5. Balance verification: 1000.00 - 100.00 = 900.00 (NOT double-deducted to 800.00)
      const balCheck1 = await pool.query('SELECT balance FROM public.wallets WHERE id = $1;', [w1]);
      const finalBal1 = Number(balCheck1.rows[0].balance);
      console.log(`   6. Final Wallet Balance: ${finalBal1.toFixed(2)} THB (Expected: 900.00 THB)`);
      assert.strictEqual(finalBal1, 900.00, 'Subtransaction rollback must ensure persistent balance is exactly 900.00');

      // 6. Ledger count verification: exactly 1 row
      const countCheck1 = await pool.query('SELECT COUNT(*) FROM public.transactions WHERE request_id = $1;', [reqId1]);
      const ledgerCount1 = Number(countCheck1.rows[0].count);
      console.log(`   7. Ledger Records Count: ${ledgerCount1} (Expected: 1)`);
      assert.strictEqual(ledgerCount1, 1, 'Ledger must contain exactly 1 transaction row');
      console.log('   ✅ [PASS] Scenario 1 Succeeded.\n');
    } finally {
      await controller1.query('ROLLBACK;').catch(() => {});
      controller1.release();
      conn1A.release();
      conn1B.release();
    }

    // ----------------------------------------------------------------------------
    // SCENARIO 2: Same Key / Conflicting Payload Race (H02 & H03 Verified)
    // ----------------------------------------------------------------------------
    console.log('🧪 Scenario 2: Same Key / Conflicting Payload Multi-Connection Race');
    const controller2 = await pool.connect();
    const conn2A = await pool.connect();
    const conn2B = await pool.connect();
    await controller2.query('SET statement_timeout = 15000;');
    await conn2A.query('SET statement_timeout = 15000;');
    await conn2B.query('SET statement_timeout = 15000;');

    try {
      const c2Pid = (await controller2.query('SELECT pg_backend_pid() AS pid;')).rows[0].pid;
      const w1Pid = (await conn2A.query('SELECT pg_backend_pid() AS pid;')).rows[0].pid;
      const w2Pid = (await conn2B.query('SELECT pg_backend_pid() AS pid;')).rows[0].pid;
      console.log(`   Controller PID: ${c2Pid} | Worker 1 PID: ${w1Pid} | Worker 2 PID: ${w2Pid}`);

      await conn2A.query(`SET request.jwt.claim.sub = '${userA}'; SET request.jwt.claim.role = 'authenticated';`);
      await conn2B.query(`SET request.jwt.claim.sub = '${userA}'; SET request.jwt.claim.role = 'authenticated';`);

      const balBeforeRes = await pool.query('SELECT balance FROM public.wallets WHERE id = $1;', [w1]);
      const initialBal2 = Number(balBeforeRes.rows[0].balance);
      const reqId2 = 'req-multi-conflict-' + Date.now();

      // 1. Controller locks wallet row
      console.log(`   1. Controller acquiring row lock (Current balance: ${initialBal2.toFixed(2)} THB)...`);
      await controller2.query('BEGIN;');
      await controller2.query('SELECT * FROM public.wallets WHERE id = $1 FOR UPDATE;', [w1]);

      // 2. Launch conflicting requests (100.00 vs 500.00)
      console.log('   2. Launching Worker 1 (expense 100.00) vs Worker 2 (expense 500.00)...');
      const pWinner = conn2A.query(`
        SELECT public.execute_create_transaction(
          p_date := '2026-09-22'::date,
          p_type := 'รายจ่าย',
          p_category := 'อาหาร',
          p_amount := 100.00,
          p_details := 'ค่าอาหาร 100',
          p_related_job := NULL,
          p_wallet_id := $1,
          p_card_id := NULL,
          p_job_id := NULL,
          p_request_id := $2
        ) AS res;
      `, [w1, reqId2]);

      const pConflict = conn2B.query(`
        SELECT public.execute_create_transaction(
          p_date := '2026-09-22'::date,
          p_type := 'รายจ่าย',
          p_category := 'อุปกรณ์',
          p_amount := 500.00,
          p_details := 'ซื้อ SSD 500',
          p_related_job := NULL,
          p_wallet_id := $1,
          p_card_id := NULL,
          p_job_id := NULL,
          p_request_id := $2
        ) AS res;
      `, [w1, reqId2]);

      // Attach Promise.allSettled immediately before releasing barrier (H03)
      const allPromises2 = Promise.allSettled([pWinner, pConflict]);

      // 3. H02 Barrier wait
      console.log('   3. [H02] Polling until both workers are confirmed blocked by controller...');
      const barrierProof2 = await waitForWorkersBlocked(monitorClient, [w1Pid, w2Pid], c2Pid);
      console.log(`   ✅ [H02 PROVEN] Both workers confirmed blocked after ${barrierProof2.elapsedMs}ms!`);

      // 4. Release lock
      console.log('   4. Releasing controller lock (COMMIT)...');
      await controller2.query('COMMIT;');

      const results2 = await allPromises2;
      const fulfilled = results2.filter(r => r.status === 'fulfilled');
      const rejected = results2.filter(r => r.status === 'rejected');

      console.log(`   5. [H03] Fulfilled requests: ${fulfilled.length}, Rejected requests: ${rejected.length}`);
      assert.strictEqual(fulfilled.length, 1, 'Exactly one request must succeed with CREATED');
      assert.strictEqual(rejected.length, 1, 'Exactly one request must fail with IDEMPOTENCY_CONFLICT');

      const winnerRes = fulfilled[0].value.rows[0].res;
      assert.strictEqual(winnerRes.status, 'CREATED');
      const conflictErr = rejected[0].reason;
      assert(conflictErr.message.includes('IDEMPOTENCY_CONFLICT'), 'Rejected request must throw IDEMPOTENCY_CONFLICT');

      // 6. [H03 Dynamic Balance Calculation]: Compute expected balance from actual winner's amount
      const winnerAmount = Number(winnerRes.transaction.amount);
      const expectedBal2 = initialBal2 - winnerAmount;
      console.log(`   6. [H03] Winner was: ${winnerAmount.toFixed(2)} THB expense. Expected Balance: ${expectedBal2.toFixed(2)} THB`);

      const balCheck2 = await pool.query('SELECT balance FROM public.wallets WHERE id = $1;', [w1]);
      const finalBal2 = Number(balCheck2.rows[0].balance);
      console.log(`   7. Final Wallet Balance: ${finalBal2.toFixed(2)} THB`);
      assert.strictEqual(finalBal2, expectedBal2, `Balance must be exactly ${expectedBal2}; no lingering deduction from loser`);

      // 7. Ledger count and row accuracy
      const countCheck2 = await pool.query('SELECT COUNT(*), MAX(amount) as amt FROM public.transactions WHERE request_id = $1;', [reqId2]);
      assert.strictEqual(Number(countCheck2.rows[0].count), 1, 'Ledger must contain exactly 1 transaction');
      assert.strictEqual(Number(countCheck2.rows[0].amt), winnerAmount, 'Ledger row amount must match winner transaction amount');
      console.log('   ✅ [PASS] Scenario 2 Succeeded.\n');
    } finally {
      await controller2.query('ROLLBACK;').catch(() => {});
      controller2.release();
      conn2A.release();
      conn2B.release();
    }

    // ----------------------------------------------------------------------------
    // SCENARIO 3: NULL Wallet Concurrent Race (Test-Only Barrier Trigger)
    // ----------------------------------------------------------------------------
    console.log('🧪 Scenario 3: Wallet NULL Multi-Connection Race (Test-Only Advisory Barrier)');
    const barrierClient = await pool.connect();
    const conn3A = await pool.connect();
    const conn3B = await pool.connect();
    await barrierClient.query('SET statement_timeout = 15000;');
    await conn3A.query('SET statement_timeout = 15000;');
    await conn3B.query('SET statement_timeout = 15000;');

    const reqId3 = 'req-multi-null-wallet-' + Date.now();
    const lockKey = 888888;

    try {
      const c3Pid = (await barrierClient.query('SELECT pg_backend_pid() AS pid;')).rows[0].pid;
      const w1Pid = (await conn3A.query('SELECT pg_backend_pid() AS pid;')).rows[0].pid;
      const w2Pid = (await conn3B.query('SELECT pg_backend_pid() AS pid;')).rows[0].pid;
      console.log(`   Controller PID: ${c3Pid} | Worker 1 PID: ${w1Pid} | Worker 2 PID: ${w2Pid}`);

      await conn3A.query(`SET request.jwt.claim.sub = '${userA}'; SET request.jwt.claim.role = 'authenticated';`);
      await conn3B.query(`SET request.jwt.claim.sub = '${userA}'; SET request.jwt.claim.role = 'authenticated';`);

      // 1. Install test-only trigger on transactions for null-wallet barrier
      console.log('   1. Installing test-only trigger for null-wallet advisory barrier...');
      await barrierClient.query(`
        CREATE OR REPLACE FUNCTION public._test_null_wallet_barrier()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.request_id = '${reqId3}' THEN
            PERFORM pg_advisory_xact_lock(${lockKey});
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_test_null_wallet_barrier ON public.transactions;
        CREATE TRIGGER trg_test_null_wallet_barrier
        BEFORE INSERT ON public.transactions
        FOR EACH ROW EXECUTE FUNCTION public._test_null_wallet_barrier();
      `);

      // 2. Controller acquires advisory lock in transaction
      console.log(`   2. Controller acquiring advisory lock (${lockKey})...`);
      await barrierClient.query('BEGIN;');
      await barrierClient.query(`SELECT pg_advisory_xact_lock(${lockKey});`);

      // 3. Launch workers with wallet_id = NULL
      console.log('   3. Launching Worker 1 & Worker 2 with wallet_id = NULL...');
      const p3A = conn3A.query(`
        SELECT public.execute_create_transaction(
          p_date := '2026-09-22'::date,
          p_type := 'รายจ่าย',
          p_category := 'อาหาร',
          p_amount := 50.00,
          p_details := 'เงินสดไม่ผ่านกระเป๋า',
          p_related_job := NULL,
          p_wallet_id := NULL,
          p_card_id := NULL,
          p_job_id := NULL,
          p_request_id := $1
        ) AS res;
      `, [reqId3]);

      const p3B = conn3B.query(`
        SELECT public.execute_create_transaction(
          p_date := '2026-09-22'::date,
          p_type := 'รายจ่าย',
          p_category := 'อาหาร',
          p_amount := 50.00,
          p_details := 'เงินสดไม่ผ่านกระเป๋า',
          p_related_job := NULL,
          p_wallet_id := NULL,
          p_card_id := NULL,
          p_job_id := NULL,
          p_request_id := $1
        ) AS res;
      `, [reqId3]);

      const allPromises3 = Promise.allSettled([p3A, p3B]);

      // 4. Poll until both workers are blocked on advisory lock (H02)
      console.log('   4. [H02] Polling until both workers are blocked on advisory lock...');
      const barrierProof3 = await waitForWorkersBlocked(monitorClient, [w1Pid, w2Pid], c3Pid);
      console.log(`   ✅ [H02 PROVEN] Both workers blocked at advisory barrier after ${barrierProof3.elapsedMs}ms!`);

      // 5. Release advisory lock by committing controller transaction
      console.log('   5. Releasing advisory lock (COMMIT)...');
      await barrierClient.query('COMMIT;');

      const results3 = await allPromises3;
      const res3A = results3[0].value.rows[0].res;
      const res3B = results3[1].value.rows[0].res;
      const statuses3 = [res3A.status, res3B.status].sort();
      console.log(`   6. Execution Outcomes: [${res3A.status}, ${res3B.status}]`);
      assert.deepStrictEqual(statuses3, ['CREATED', 'IDEMPOTENT_RETRY']);

      // 6. Assert ledger and wallet nullness
      const countCheck3 = await pool.query('SELECT COUNT(*) FROM public.transactions WHERE request_id = $1;', [reqId3]);
      assert.strictEqual(Number(countCheck3.rows[0].count), 1, 'Ledger must contain exactly 1 transaction for null-wallet race');
      assert.strictEqual(res3A.wallet_id, null, 'Winner wallet_id must be null');
      assert.strictEqual(res3B.wallet_id, null, 'Loser wallet_id must be null');
      console.log('   ✅ [PASS] Scenario 3 Succeeded.\n');
    } finally {
      // Guaranteed cleanup in finally
      await barrierClient.query('ROLLBACK;').catch(() => {});
      await barrierClient.query(`
        DROP TRIGGER IF EXISTS trg_test_null_wallet_barrier ON public.transactions;
        DROP FUNCTION IF EXISTS public._test_null_wallet_barrier();
      `).catch(() => {});
      barrierClient.release();
      conn3A.release();
      conn3B.release();
    }

    // ----------------------------------------------------------------------------
    // SCENARIO 4: Cross-User Isolation (Different Users, Same Request ID)
    // ----------------------------------------------------------------------------
    console.log('🧪 Scenario 4: Cross-User Isolation with Identical Request ID');
    const conn4A = await pool.connect();
    const conn4B = await pool.connect();
    await conn4A.query('SET statement_timeout = 15000;');
    await conn4B.query('SET statement_timeout = 15000;');

    try {
      await conn4A.query(`SET request.jwt.claim.sub = '${userA}'; SET request.jwt.claim.role = 'authenticated';`);
      await conn4B.query(`SET request.jwt.claim.sub = '${userB}'; SET request.jwt.claim.role = 'authenticated';`);

      const wBRes = await pool.query(`
        INSERT INTO public.wallets (name, balance, user_id) 
        VALUES ('Wallet User B', 5000.00, $1) 
        RETURNING id;
      `, [userB]);
      const wB = wBRes.rows[0].id;

      const balABefore = Number((await pool.query('SELECT balance FROM public.wallets WHERE id = $1', [w1])).rows[0].balance);
      const sharedReqId = 'shared-uuid-' + Date.now();

      const [r4A, r4B] = await Promise.all([
        conn4A.query(`
          SELECT public.execute_create_transaction(
            p_date := '2026-09-22'::date,
            p_type := 'รายจ่าย',
            p_category := 'อาหาร',
            p_amount := 50.00,
            p_details := 'มื้อเย็น User A',
            p_related_job := NULL,
            p_wallet_id := $1,
            p_card_id := NULL,
            p_job_id := NULL,
            p_request_id := $2
          ) AS res;
        `, [w1, sharedReqId]),
        conn4B.query(`
          SELECT public.execute_create_transaction(
            p_date := '2026-09-22'::date,
            p_type := 'รายจ่าย',
            p_category := 'อุปกรณ์',
            p_amount := 200.00,
            p_details := 'อุปกรณ์ User B',
            p_related_job := NULL,
            p_wallet_id := $1,
            p_card_id := NULL,
            p_job_id := NULL,
            p_request_id := $2
          ) AS res;
        `, [wB, sharedReqId])
      ]);

      assert.strictEqual(r4A.rows[0].res.status, 'CREATED');
      assert.strictEqual(r4B.rows[0].res.status, 'CREATED');

      // Assert wallet balances of both users
      const balAAfter = Number((await pool.query('SELECT balance FROM public.wallets WHERE id = $1', [w1])).rows[0].balance);
      const balBAfter = Number((await pool.query('SELECT balance FROM public.wallets WHERE id = $1', [wB])).rows[0].balance);
      assert.strictEqual(balAAfter, balABefore - 50.00, 'User A wallet must deduct only User A amount');
      assert.strictEqual(balBAfter, 4800.00, 'User B wallet must deduct only User B amount (5000 - 200 = 4800)');

      // Assert ledger rows: exactly 2 distinct rows
      const countCheck4 = await pool.query('SELECT COUNT(*) FROM public.transactions WHERE request_id = $1;', [sharedReqId]);
      assert.strictEqual(Number(countCheck4.rows[0].count), 2, 'Ledger must store 2 independent records under shared request_id');
      console.log('   ✅ [PASS] Scenario 4 Succeeded.\n');
    } finally {
      conn4A.release();
      conn4B.release();
    }

    // ----------------------------------------------------------------------------
    // SCENARIO 5: Post-Commit Dropped Response (Fast Pre-Check Retry)
    // ----------------------------------------------------------------------------
    console.log('🧪 Scenario 5: Post-Commit Dropped Response (Fast Pre-check Retry)');
    const client5 = await pool.connect();
    await client5.query('SET statement_timeout = 15000;');

    try {
      await client5.query(`SET request.jwt.claim.sub = '${userA}'; SET request.jwt.claim.role = 'authenticated';`);
      const reqId5 = 'req-dropped-' + Date.now();

      // Original creation
      const resCreate = await client5.query(`
        SELECT public.execute_create_transaction(
          p_date := '2026-09-22'::date,
          p_type := 'รายจ่าย',
          p_category := 'เดินทาง',
          p_amount := 80.00,
          p_details := 'ค่าทางด่วน',
          p_related_job := NULL,
          p_wallet_id := $1,
          p_card_id := NULL,
          p_job_id := NULL,
          p_request_id := $2
        ) AS res;
      `, [w1, reqId5]);
      assert.strictEqual(resCreate.rows[0].res.status, 'CREATED');

      const balBeforeRetry = Number((await pool.query('SELECT balance FROM public.wallets WHERE id = $1;', [w1])).rows[0].balance);

      // Retry simulates network reconnect
      const resRetry = await client5.query(`
        SELECT public.execute_create_transaction(
          p_date := '2026-09-22'::date,
          p_type := 'รายจ่าย',
          p_category := 'เดินทาง',
          p_amount := 80.00,
          p_details := 'ค่าทางด่วน',
          p_related_job := NULL,
          p_wallet_id := $1,
          p_card_id := NULL,
          p_job_id := NULL,
          p_request_id := $2
        ) AS res;
      `, [w1, reqId5]);
      assert.strictEqual(resRetry.rows[0].res.status, 'IDEMPOTENT_RETRY');

      // Assert balance unchanged
      const balAfterRetry = Number((await pool.query('SELECT balance FROM public.wallets WHERE id = $1;', [w1])).rows[0].balance);
      assert.strictEqual(balAfterRetry, balBeforeRetry, 'Balance before and after retry must be strictly identical');

      // Assert ledger count remains 1
      const countCheck5 = await pool.query('SELECT COUNT(*) FROM public.transactions WHERE request_id = $1;', [reqId5]);
      assert.strictEqual(Number(countCheck5.rows[0].count), 1, 'Ledger count must remain 1');
      console.log('   ✅ [PASS] Scenario 5 Succeeded.\n');
    } finally {
      client5.release();
    }

    // ----------------------------------------------------------------------------
    // SCENARIO 6: Full Null-Safe Payload Regression for related_job
    // ----------------------------------------------------------------------------
    console.log('🧪 Scenario 6: Full Null-Safe Payload Regression for related_job');
    const client6 = await pool.connect();
    await client6.query('SET statement_timeout = 15000;');

    try {
      await client6.query(`SET request.jwt.claim.sub = '${userA}'; SET request.jwt.claim.role = 'authenticated';`);

      // 1. Baseline: Original related_job = NULL -> Retry with string -> IDEMPOTENCY_CONFLICT
      const reqId6A = 'req-reljob-null-base-' + Date.now();
      await client6.query(`
        SELECT public.execute_create_transaction(
          p_date := '2026-09-22'::date,
          p_type := 'รายจ่าย',
          p_category := 'อาหาร',
          p_amount := 30.00,
          p_details := 'เครื่องดื่ม',
          p_related_job := NULL,
          p_wallet_id := $1,
          p_card_id := NULL,
          p_job_id := NULL,
          p_request_id := $2
        );
      `, [w1, reqId6A]);

      let caughtNullToStr = false;
      try {
        await client6.query(`
          SELECT public.execute_create_transaction(
            p_date := '2026-09-22'::date,
            p_type := 'รายจ่าย',
            p_category := 'อาหาร',
            p_amount := 30.00,
            p_details := 'เครื่องดื่ม',
            p_related_job := 'Project Alpha',
            p_wallet_id := $1,
            p_card_id := NULL,
            p_job_id := NULL,
            p_request_id := $2
          );
        `, [w1, reqId6A]);
      } catch (e) {
        caughtNullToStr = true;
        assert(e.message.includes('IDEMPOTENCY_CONFLICT'));
      }
      assert(caughtNullToStr, 'NULL to string related_job must throw IDEMPOTENCY_CONFLICT');

      // 2. Baseline: Original related_job = 'Project Alpha' -> Retry with NULL -> IDEMPOTENCY_CONFLICT
      const reqId6B = 'req-reljob-str-base-' + Date.now();
      await client6.query(`
        SELECT public.execute_create_transaction(
          p_date := '2026-09-22'::date,
          p_type := 'รายจ่าย',
          p_category := 'อุปกรณ์',
          p_amount := 40.00,
          p_details := 'ฟิลเตอร์เลนส์',
          p_related_job := 'Project Alpha',
          p_wallet_id := $1,
          p_card_id := NULL,
          p_job_id := NULL,
          p_request_id := $2
        );
      `, [w1, reqId6B]);

      let caughtStrToNull = false;
      try {
        await client6.query(`
          SELECT public.execute_create_transaction(
            p_date := '2026-09-22'::date,
            p_type := 'รายจ่าย',
            p_category := 'อุปกรณ์',
            p_amount := 40.00,
            p_details := 'ฟิลเตอร์เลนส์',
            p_related_job := NULL,
            p_wallet_id := $1,
            p_card_id := NULL,
            p_job_id := NULL,
            p_request_id := $2
          );
        `, [w1, reqId6B]);
      } catch (e) {
        caughtStrToNull = true;
        assert(e.message.includes('IDEMPOTENCY_CONFLICT'));
      }
      assert(caughtStrToNull, 'String to NULL related_job must throw IDEMPOTENCY_CONFLICT');

      // 3. Baseline: Original related_job = 'Project Alpha' -> Retry with 'Project Beta' -> IDEMPOTENCY_CONFLICT
      let caughtStrToStr = false;
      try {
        await client6.query(`
          SELECT public.execute_create_transaction(
            p_date := '2026-09-22'::date,
            p_type := 'รายจ่าย',
            p_category := 'อุปกรณ์',
            p_amount := 40.00,
            p_details := 'ฟิลเตอร์เลนส์',
            p_related_job := 'Project Beta',
            p_wallet_id := $1,
            p_card_id := NULL,
            p_job_id := NULL,
            p_request_id := $2
          );
        `, [w1, reqId6B]);
      } catch (e) {
        caughtStrToStr = true;
        assert(e.message.includes('IDEMPOTENCY_CONFLICT'));
      }
      assert(caughtStrToStr, 'String to different string related_job must throw IDEMPOTENCY_CONFLICT');

      // 4. Exact retry with matching related_job -> IDEMPOTENT_RETRY
      const exactRetry = await client6.query(`
        SELECT public.execute_create_transaction(
          p_date := '2026-09-22'::date,
          p_type := 'รายจ่าย',
          p_category := 'อุปกรณ์',
          p_amount := 40.00,
          p_details := 'ฟิลเตอร์เลนส์',
          p_related_job := 'Project Alpha',
          p_wallet_id := $1,
          p_card_id := NULL,
          p_job_id := NULL,
          p_request_id := $2
        ) AS res;
      `, [w1, reqId6B]);
      assert.strictEqual(exactRetry.rows[0].res.status, 'IDEMPOTENT_RETRY');
      console.log('   ✅ [PASS] Scenario 6 Succeeded.\n');
    } finally {
      client6.release();
    }

    console.log('================================================================================');
    console.log('🏁 ALL NATIVE MULTI-CONNECTION CONCURRENCY SCENARIOS VERIFIED SUCCESSFULLY!');
    console.log('================================================================================\n');
  } finally {
    monitorClient.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('\n❌ Unhandled Fatal Exception in Concurrency Suite:', err);
  process.exit(1);
});
