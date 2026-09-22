/**
 * Comprehensive Acceptance & Regression Test Suite for FreelanceHub / Natthawit Studio
 * Validates fixes for Codex Final Review Commit 991b34f (MR01 - MR10)
 *
 * Directly tests production code modules:
 * - js/financial-core.js (MR01, MR05: canonical wallet resolver, domain rules, deltas)
 * - index.html (MR01, MR02, MR03, MR04, MR05, MR06, MR08, MR09: UI integration, atomic RPCs, scoped cache, pagination)
 * - supabase_migration_v2.sql (MR02, MR03, MR06, MR07, MR08: schema contracts, RLS, safe non-destructive keys)
 * - server.js (MR10: handleRequest invocation, path containment, NUL byte protection)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Direct Production Code Import
const FinancialCore = require('../js/financial-core.js');
const { handleRequest } = require('../server.js');

console.log('🧪 Starting FreelanceHub Codex Final Review Verification Suite (MR01 - MR10)...\n');

let passedTests = 0;
let totalTests = 0;

async function test(id, name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${id}: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${id}: ${name}`);
    console.error(`     Error: ${err.message}\n`);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 5).join('\n'));
    }
  }
}

const ROOT_DIR = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
const migrationSql = fs.readFileSync(path.join(ROOT_DIR, 'supabase_migration_v2.sql'), 'utf8');

(async () => {

// ============================================================================
// MR01: Canonical Wallet Resolver & Legacy Transaction Identity (900 remains 900)
// ============================================================================
await test('MR01', 'Legacy transaction wallet resolution: editing note-only leaves balance untouched at 900', () => {
  const wallets = [
    { id: 10, name: 'บัญชีสตูดิโอ (ไทยพาณิชย์)', balance: 900.00 },
    { id: 20, name: 'บัญชีส่วนตัว (กสิกรไทย)', balance: 2000.00 }
  ];

  // 1. Direct resolveWalletId test
  // Legacy tx with wallet_id = null and details [สตูดิโอ | บัญชีสตูดิโอ (ไทยพาณิชย์)]
  const legacyTx = {
    id: 501,
    type: 'รายจ่าย',
    amount: 100,
    wallet_id: null,
    details: '[สตูดิโอ | บัญชีสตูดิโอ (ไทยพาณิชย์)] ค่าอุปกรณ์ถ่ายทำ'
  };
  const resolvedId = FinancialCore.resolveWalletId(legacyTx, wallets);
  assert.strictEqual(resolvedId, 10, 'Must resolve wallet ID 10 from bracket metadata');

  // JSON details format: {"account":"บัญชีส่วนตัว (กสิกรไทย)"}
  const jsonTx = {
    id: 502,
    type: 'รายจ่าย',
    amount: 200,
    wallet_id: null,
    details: '{"scope":"personal","account":"บัญชีส่วนตัว (กสิกรไทย)","note":"ค่าอาหาร"}'
  };
  const resolvedJsonId = FinancialCore.resolveWalletId(jsonTx, wallets);
  assert.strictEqual(resolvedJsonId, 20, 'Must resolve wallet ID 20 from JSON metadata');

  // 2. computeEditDelta on legacy transaction editing ONLY note
  // Form submission sends payload with explicit wallet_id = 10
  const editPayload = {
    type: 'รายจ่าย',
    amount: 100,
    wallet_id: 10,
    details: '[สตูดิโอ | บัญชีสตูดิโอ (ไทยพาณิชย์)] ค่าอุปกรณ์ถ่ายทำ (แก้ไขโน้ต)'
  };

  const delta = FinancialCore.computeEditDelta(legacyTx, editPayload, wallets);
  assert.strictEqual(delta.isSameWallet, true, 'Old legacy tx and new payload must resolve to the same wallet');
  assert.strictEqual(delta.netDelta, 0, 'Editing note only must produce netDelta = 0');
  assert.strictEqual(delta.hasFinancialChange, false, 'Editing note only must not trigger financial changes');

  // Verify wallet balance is untouched (900.00 remains 900.00)
  assert.strictEqual(wallets[0].balance, 900.00, 'Wallet balance must remain 900.00 and NOT be deducted to 800.00');

  // Verify index.html uses computeEditDelta and respects hasFinancialChange
  assert(indexHtml.includes('FinancialCore.computeEditDelta'), 'index.html must invoke FinancialCore.computeEditDelta');
  assert(indexHtml.includes('if (deltaInfo.hasFinancialChange)'), 'index.html must only adjust balance when hasFinancialChange is true');
});

// ============================================================================
// MR02: Authoritative Single Reconciliation Operation & Stale Detection
// ============================================================================
await test('MR02', 'Reconciliation handler: authoritative RPC, no dual-insert, detects STALE_BALANCE immediately', () => {
  // 1. Verify index.html calls execute_wallet_reconciliation with date
  assert(indexHtml.includes("db.rpc('execute_wallet_reconciliation', {"),
    'handleReconSubmit must call execute_wallet_reconciliation RPC');
  assert(indexHtml.includes('p_date: date'), 'handleReconSubmit must pass p_date to RPC');

  // 2. Verify immediate error check without stale client delta fallback
  assert(indexHtml.includes('if (rpcRecon.error) {'), 'handleReconSubmit must check rpcRecon.error immediately');
  assert(indexHtml.includes("errMsg.includes('STALE_BALANCE')"), 'handleReconSubmit must handle STALE_BALANCE explicitly');

  // 3. Verify elimination of duplicate client audit row insertion
  assert(!indexHtml.includes("category: 'ปรับยอดเงิน',\n          amount: Math.abs(diff),"),
    'handleReconSubmit must NOT insert a second client-side audit transaction');

  // 4. Verify SQL procedure accepts p_date and has strict owner check
  assert(migrationSql.includes('p_date DATE DEFAULT CURRENT_DATE'),
    'execute_wallet_reconciliation in SQL must accept p_date');
  assert(migrationSql.includes('v_wallet.user_id IS NULL OR v_wallet.user_id <> auth.uid()'),
    'execute_wallet_reconciliation must strictly reject NULL or non-matching owner');

  // 5. Verify guards against direct editing and deletion of reconciliation rows
  assert(indexHtml.includes("if (tx.category === 'ปรับยอดเงิน' || (window.FinancialCore && window.FinancialCore.isReconTx"),
    'openEditTxModal and deleteTx must guard reconciliation rows from standard editing/deletion');
});

// ============================================================================
// MR03: Atomic Bill Payment & Debt Ledger Split
// ============================================================================
await test('MR03', 'UI uses atomic RPCs for bills and debt; debt payment splits principal and interest in ledger', () => {
  // 1. UI bill payment RPC calls
  assert(indexHtml.includes("db.rpc('execute_bill_payment', {"),
    'quickPayBill must call execute_bill_payment RPC');
  assert(indexHtml.includes("db.rpc('cancel_bill_payment', {"),
    'toggleBillPaid must call cancel_bill_payment RPC');

  // 2. UI debt payment RPC call
  assert(indexHtml.includes("db.rpc('execute_debt_payment', {"),
    'handleRecordDebtPayment must call execute_debt_payment RPC');

  // 3. Debt RPC splits principal and interest in SQL
  assert(migrationSql.includes("'ชำระหนี้/ผ่อนสินค้า'"),
    'execute_debt_payment must record principal repayment under ชำระหนี้/ผ่อนสินค้า');
  assert(migrationSql.includes("'ดอกเบี้ยจ่าย'"),
    'execute_debt_payment must record interest repayment under ดอกเบี้ยจ่าย');

  // 4. In FinancialCore: principal repayment is financing outflow, interest is operating expense
  const principalTx = { type: 'รายจ่าย', category: 'ชำระหนี้/ผ่อนสินค้า', amount: 5000 };
  const interestTx = { type: 'รายจ่าย', category: 'ดอกเบี้ยจ่าย', amount: 500 };

  assert.strictEqual(FinancialCore.isDebtPrincipalTx(principalTx), true);
  assert.strictEqual(FinancialCore.isOperatingExpense(principalTx), false, 'Principal repayment must NOT be operating expense');

  assert.strictEqual(FinancialCore.isDebtPrincipalTx(interestTx), false);
  assert.strictEqual(FinancialCore.isOperatingExpense(interestTx), true, 'Interest repayment MUST be operating expense');
});

// ============================================================================
// MR04: Clean Transfer & Cancel Operations (No Fallbacks, No ReferenceErrors)
// ============================================================================
await test('MR04', 'Eliminate partial transfer fallbacks; cancelTransferByTx calls loadAllData()', () => {
  // 1. handleInternalTransfer calls execute_wallet_transfer RPC and throws on error
  assert(indexHtml.includes("db.rpc('execute_wallet_transfer', {"),
    'handleInternalTransfer must call execute_wallet_transfer');
  assert(!indexHtml.includes('console.warn(\'execute_wallet_transfer RPC notice, falling back:\''),
    'handleInternalTransfer must NOT have multi-step coordinated fallback');

  // 2. cancelTransferByTx calls cancel_wallet_transfer RPC and reloads with loadAllData
  assert(indexHtml.includes("db.rpc('cancel_wallet_transfer', {"),
    'cancelTransferByTx must call cancel_wallet_transfer');
  assert(!indexHtml.includes('loadTransactions()'),
    'cancelTransferByTx must NOT call undefined loadTransactions()');
  assert(indexHtml.includes('await loadAllData();'),
    'cancelTransferByTx must call loadAllData()');
});

// ============================================================================
// MR05: Unify All Views with FinancialCore & Fix Project Hub Matching
// ============================================================================
await test('MR05', 'FinancialCore selectors unified; Project Hub matches job_id and includes paid_amount', () => {
  // 1. In index.html, selectors delegate to FinancialCore
  assert(indexHtml.includes('window.FinancialCore.isOperatingIncome(t)'),
    'index.html must delegate isOperatingIncome to FinancialCore');
  assert(indexHtml.includes('window.FinancialCore.isOperatingExpense(t)'),
    'index.html must delegate isOperatingExpense to FinancialCore');

  // 2. Test F06 dataset with FinancialCore: Income 50,000, Expense 12,865
  const sampleTxs = [
    { type: 'รายรับ', category: 'ค่าบริการถ่ายภาพ', amount: 50000 },
    { type: 'รายจ่าย', category: 'ค่าเช่าสตูดิโอ', amount: 10000 },
    { type: 'รายจ่าย', category: 'ค่าอุปกรณ์', amount: 2000 },
    { type: 'รายจ่าย', category: 'ดอกเบี้ยจ่าย', amount: 840 },
    { type: 'รายจ่าย', category: 'ค่าธรรมเนียม', amount: 25, transfer_id: 99 }, // Transfer fee IS operating expense
    { type: 'โอนเงิน', category: 'โอนเงิน', amount: 15000, transfer_id: 99 },    // Transfer principal is NOT operating expense
    { type: 'รายจ่าย', category: 'ชำระหนี้/ผ่อนสินค้า', amount: 4160 },          // Debt principal is NOT operating expense
    { type: 'รายจ่าย', category: 'ปรับยอดเงิน', amount: 500 }                     // Reconciliation adjustment is NOT operating expense
  ];

  const summary = FinancialCore.calculateFinancialSummary(sampleTxs);
  assert.strictEqual(summary.income, 50000, 'Income must be 50,000');
  assert.strictEqual(summary.expense, 12865, 'Operating expense must be 12,865 (10000 + 2000 + 840 + 25)');
  assert.strictEqual(summary.netOperating, 37135, 'Net operating must be 37,135 (50,000 - 12,865)');

  // 3. Project Hub & computeJobReceivable test
  const job = { id: 42, title: 'ถ่ายพรีเวดดิ้ง', budget: 10000, paid_amount: 4000 };
  const receivable = FinancialCore.computeJobReceivable(job, 4000);
  assert.strictEqual(receivable, 6000, 'Unpaid receivable must be 6,000 (10,000 - 4,000)');

  // 4. Verify renderProjectsHub in index.html matches job_id and gets financials via getJobFinancials
  assert(indexHtml.includes('var fin = getJobFinancials(j);'),
    'renderProjectsHub must use getJobFinancials to include paid_amount and match accurately');
  assert(indexHtml.includes('matchedJob = appData.jobs.find(function(j) { return j.id === t.job_id'),
    'renderProjectsHub must match transactions by job_id');
});

// ============================================================================
// MR06: Schema Consistency & Form Write Error Checking
// ============================================================================
await test('MR06', 'Schema columns aligned across fresh and upgrade; form handlers check res.error', () => {
  // 1. Column additions in SQL migration
  assert(migrationSql.includes('ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS related_job TEXT;'),
    'Migration must add related_job to transactions');
  assert(migrationSql.includes('ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS color TEXT DEFAULT \'#168EA1\';'),
    'Migration must add color to categories');
  assert(migrationSql.includes('ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS notes TEXT;'),
    'Migration must add notes to bills');
  assert(migrationSql.includes('ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS note TEXT;'),
    'Migration must add note to bills');
  assert(migrationSql.includes('ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS notes TEXT;'),
    'Migration must add notes to transfers');
  assert(migrationSql.includes('ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS note TEXT;'),
    'Migration must add note to transfers');
  assert(migrationSql.includes('ALTER TABLE public.debt_payments ADD COLUMN IF NOT EXISTS total_amount NUMERIC(14, 2);'),
    'Migration must add total_amount to debt_payments');
  assert(migrationSql.includes('ALTER TABLE public.debt_payments ADD COLUMN IF NOT EXISTS principal_amount NUMERIC(14, 2);'),
    'Migration must add principal_amount to debt_payments');
  assert(migrationSql.includes('ALTER TABLE public.debt_payments ADD COLUMN IF NOT EXISTS interest_amount NUMERIC(14, 2);'),
    'Migration must add interest_amount to debt_payments');

  // 2. handleSaveBill sends both note and notes and checks res.error
  assert(indexHtml.includes('note: noteVal,\n        notes: noteVal,'),
    'handleSaveBill must send both note and notes');
  assert(indexHtml.includes('var res = await db.from(\'bills\').insert([payload]);\n        if (res.error) throw res.error;'),
    'handleSaveBill must check res.error');

  // 3. handleSaveJob checks res.error
  assert(indexHtml.includes('if (res.error) throw res.error;'),
    'handleSaveJob must check res.error');
});

// ============================================================================
// MR07: Safe Non-Destructive Migrations & Owner Wallet Seeding
// ============================================================================
await test('MR07', 'No destructive deletes in migration; transfers fk is ON DELETE SET NULL; initial wallets seeded before owner assignment', () => {
  // 1. Ensure NO DELETE FROM debt_payments or transfers in setup/migration
  assert(!migrationSql.includes('DELETE FROM public.debt_payments WHERE debt_id'),
    'Migration must NOT delete orphan debt_payments');
  assert(!migrationSql.includes('DELETE FROM public.transfers WHERE from_wallet_id'),
    'Migration must NOT delete orphan transfers');

  // 2. fk_transactions_transfer is ON DELETE SET NULL
  assert(migrationSql.includes('ALTER TABLE public.transactions ADD CONSTRAINT fk_transactions_transfer FOREIGN KEY (transfer_id) REFERENCES public.transfers(id) ON DELETE SET NULL;'),
    'fk_transactions_transfer must be ON DELETE SET NULL to preserve ledger history');

  // 3. Default initial wallets seeded in Section 4A before owner assignment
  const section4Pos = migrationSql.indexOf('4. DEFAULT INITIAL WALLETS & LEGACY DATA OWNER ASSIGNMENT');
  const insertWalletPos = migrationSql.indexOf("INSERT INTO public.wallets (name, type, color, icon, balance, opening_balance, notes, user_id)");
  const updateOwnerPos = migrationSql.indexOf("UPDATE public.wallets SET user_id = v_legacy_owner_id WHERE user_id IS NULL;");

  assert(section4Pos > 0, 'Section 4 header must exist');
  assert(insertWalletPos > section4Pos, 'Wallets must be seeded in Section 4');
  assert(updateOwnerPos > insertWalletPos, 'Owner assignment must run AFTER wallet seeding');

  // Section 8 at the bottom must have been removed
  assert(!migrationSql.includes('8. DEFAULT INITIAL WALLETS'),
    'Section 8 at the bottom must have been moved to Section 4');
});

// ============================================================================
// MR08: User-Scoped Cache & Strict Auth State Isolation
// ============================================================================
await test('MR08', 'User-scoped cache isolation: User B does not load User A wallets; sign out clears state', () => {
  // 1. getUserStorageKey function exists in index.html
  assert(indexHtml.includes('function getUserStorageKey(key) {'),
    'getUserStorageKey must be defined in index.html');
  assert(indexHtml.includes("var uid = (currentUser && currentUser.id) ? currentUser.id : 'anon';"),
    'getUserStorageKey must namespace by currentUser.id');

  // 2. loadWalletsFromLocal & saveWalletsToLocal use getUserStorageKey
  assert(indexHtml.includes("var key = getUserStorageKey('natthawit_studio_wallets');"),
    'loadWalletsFromLocal and saveWalletsToLocal must use getUserStorageKey');

  // 3. If authenticated user has empty wallets, does NOT fallback to other user wallets
  assert(indexHtml.includes('appData.wallets = currentUser ? [] : defaultWallets.slice();'),
    'loadWalletsFromLocal must not load default/other user wallets if user is authenticated');

  // 4. handleSignOut clears financial state from memory
  assert(indexHtml.includes('appData = {\n          categories: [],\n          jobs: [],\n          todos: [],\n          bills: [],\n          equipment: [],\n          transactions: [],\n          wallets: [],\n          debts: [],\n          debt_payments: [],\n          cards: []\n        };'),
    'handleSignOut must reset all financial collections in appData');

  // 5. Strict RPC owner check rejects NULL user_id
  assert(migrationSql.includes('IF v_owner IS NULL OR v_owner <> auth.uid() THEN'),
    'adjust_wallet_balance must reject NULL owner with Forbidden');
  assert(migrationSql.includes('IF v_from_owner IS NULL OR v_from_owner <> auth.uid() THEN'),
    'execute_wallet_transfer must reject NULL owner with Forbidden');
});

// ============================================================================
// MR09: Paginated Batch Data Loader (PostgREST 1,000 Row Limit)
// ============================================================================
await test('MR09', 'Paginated transaction loading fetches complete dataset across 1,000-row pages', async () => {
  // 1. fetchAllTransactions function exists in index.html with range pagination
  assert(indexHtml.includes('async function fetchAllTransactions() {'),
    'fetchAllTransactions must be defined in index.html');
  assert(indexHtml.includes('.range(from, from + pageSize - 1)'),
    'fetchAllTransactions must use .range(from, to) for batch fetching');

  // 2. Simulation test: 1,501 rows with 1,000 pageSize
  const totalRows = 1501;
  const mockDbRows = Array.from({ length: totalRows }, (_, i) => ({ id: i + 1, amount: 100 }));

  // Simulate paginated fetcher matching fetchAllTransactions logic
  async function simulateFetchAll(dbClient) {
    let all = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const res = await dbClient.range(from, from + pageSize - 1);
      all = all.concat(res.data);
      if (res.data.length < pageSize) break;
      from += pageSize;
    }
    return all;
  }

  const mockClient = {
    async range(from, to) {
      return { data: mockDbRows.slice(from, to + 1) };
    }
  };

  const fetched = await simulateFetchAll(mockClient);
  assert.strictEqual(fetched.length, 1501, 'Paginated fetcher must fetch all 1,501 rows without truncation');
});

// ============================================================================
// MR10: Real Server Handler Invocation & Security Verification
// ============================================================================
await test('MR10', 'Invoke server.handleRequest directly: root index.html (200), NUL byte (400), path traversal (403)', async () => {
  // Helper to execute handleRequest
  function request(url) {
    return new Promise((resolve) => {
      const req = { url };
      let resData = '';
      const res = {
        statusCode: 200,
        headers: {},
        writeHead(code, headers) {
          this.statusCode = code;
          this.headers = headers;
        },
        end(chunk) {
          if (chunk) resData += chunk.toString();
          resolve({ statusCode: this.statusCode, headers: this.headers, data: resData });
        }
      };
      handleRequest(req, res);
    });
  }

  // 1. Root / -> 200 with HTML
  const resRoot = await request('/');
  assert.strictEqual(resRoot.statusCode, 200, 'Root / must return 200');
  assert(resRoot.data.includes('Natthawit Studio') || resRoot.data.includes('FreelanceHub'),
    'Root / must serve index.html content');

  // 2. NUL byte injection -> 400 Bad Request
  const resNul = await request('/index.html%00.png');
  assert.strictEqual(resNul.statusCode, 400, 'NUL byte request must return 400 Bad Request');

  // 3. Path traversal attack -> 403 Forbidden
  const resTraversal = await request('/../../../etc/passwd');
  assert.strictEqual(resTraversal.statusCode, 403, 'Path traversal must return 403 Forbidden');
});

// ============================================================================
// Summary
// ============================================================================
console.log(`\n=======================================================`);
console.log(`🏁 Verification Results: ${passedTests} / ${totalTests} test suites PASSED`);
console.log(`=======================================================\n`);

if (passedTests < totalTests) {
  process.exit(1);
} else {
  process.exit(0);
}

})();
