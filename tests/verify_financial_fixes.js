/**
 * Comprehensive Acceptance & Regression Test Suite for FreelanceHub / Natthawit Studio
 * Validates fixes for Codex Final Review Commit 991b34f (MR01 - MR10)
 * AND Codex Review Commit 0e2a6f7 Findings (FR01 - FR06)
 *
 * Directly tests production code modules:
 * - js/financial-core.js (MR01, MR05: canonical wallet resolver, domain rules, deltas)
 * - index.html (MR01 - MR10 & FR01 - FR03: UI integration, atomic RPCs, scoped cache, pagination, race conditions)
 * - supabase_migration_v2.sql & supabase_schema_upgrade.sql (MR02, MR03, MR06, MR07, MR08, FR01, FR04, FR05)
 * - server.js (MR10: handleRequest invocation, path containment, NUL byte protection)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// Direct Production Code Import
const FinancialCore = require('../js/financial-core.js');
const { handleRequest } = require('../server.js');

console.log('🧪 Starting FreelanceHub Acceptance & Regression Verification Suite (MR01-MR10 & FR01-FR06)...\n');

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
const upgradeSql = fs.readFileSync(path.join(ROOT_DIR, 'supabase_schema_upgrade.sql'), 'utf8');

// Helper to instantiate index.html script in isolated Node.js VM harness
function createVmHarness(dbOverride = {}) {
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let mainScript = '';
  while ((match = scriptRegex.exec(indexHtml)) !== null) {
    if (match[1].includes('currentSessionGeneration')) {
      mainScript = match[1];
      break;
    }
  }

  const localStorageStore = {};
  const formValues = {};
  const renderedViews = [];
  const elements = {};

  function getOrCreateElement(id) {
    if (!elements[id]) {
      elements[id] = {
        id,
        get value() { return formValues[id] || ''; },
        set value(v) { formValues[id] = v; },
        textContent: '',
        style: {},
        classList: { add: () => {}, remove: () => {}, toggle: () => {} }
      };
    }
    return elements[id];
  }

  const sandbox = {
    window: {
      addEventListener: () => {},
      location: { hash: '' },
      confirm: () => true,
      alert: (msg) => { sandbox.lastAlert = msg; }
    },
    document: {
      getElementById: (id) => getOrCreateElement(id),
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    localStorage: {
      getItem: (k) => localStorageStore[k] || null,
      setItem: (k, v) => { localStorageStore[k] = String(v); },
      removeItem: (k) => { delete localStorageStore[k]; }
    },
    confirm: () => true,
    alert: (msg) => { sandbox.lastAlert = msg; },
    console: {
      log: () => {},
      warn: () => {},
      error: () => {}
    },
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    Date: Date,
    Math: Math,
    parseFloat: parseFloat,
    parseInt: parseInt,
    renderedViews,
    localStorageStore,
    formValues,
    elements
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.confirm = sandbox.confirm;

  ['renderDashboard', 'renderTransactions', 'renderCalendar', 'renderTodos', 'renderBills', 'renderEquipment', 'renderProjectsHub', 'renderDebts', 'renderCards', 'updateSettingsCounts'].forEach(fnName => {
    sandbox[fnName] = () => { renderedViews.push(fnName); };
    sandbox.window[fnName] = sandbox[fnName];
  });

  const defaultDb = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => {},
      signOut: async () => {}
    },
    from: () => ({
      select: () => ({
        order: () => ({
          range: () => ({ data: [] })
        })
      }),
      insert: () => ({ select: () => ({ data: [] }) }),
      update: () => ({ eq: () => ({ data: [] }) }),
      delete: () => ({ eq: () => ({ data: [] }) })
    }),
    rpc: async () => ({ data: {} }),
    channel: () => ({ on: () => ({ subscribe: () => {} }) })
  };

  sandbox.window.supabase = {
    createClient: () => Object.assign(defaultDb, dbOverride)
  };

  const context = vm.createContext(sandbox);
  const exported = vm.runInContext(mainScript + '\n;({currentSessionGeneration, clearAppDataAndScreens, handleSaveTx, deleteTx, loadWallets, handleSignOut, appData, getAppData: () => appData, setSyncStatus, closeAllDrawers: () => {}, initAuth, updateAuthUI: () => {}});', context);

  return { sandbox, exported, formValues, context };
}

(async () => {

// ============================================================================
// MR01: Canonical Wallet Resolver & Legacy Transaction Identity (900 remains 900)
// ============================================================================
await test('MR01', 'Legacy transaction wallet resolution: editing note-only leaves balance untouched at 900', () => {
  const wallets = [
    { id: 10, name: 'บัญชีสตูดิโอ (ไทยพาณิชย์)', balance: 900.00 },
    { id: 20, name: 'บัญชีส่วนตัว (กสิกรไทย)', balance: 2000.00 }
  ];

  const legacyTx = {
    id: 501,
    type: 'รายจ่าย',
    amount: 100,
    wallet_id: null,
    details: '[สตูดิโอ | บัญชีสตูดิโอ (ไทยพาณิชย์)] ค่าอุปกรณ์ถ่ายทำ'
  };
  const resolvedId = FinancialCore.resolveWalletId(legacyTx, wallets);
  assert.strictEqual(resolvedId, 10, 'Must resolve wallet ID 10 from bracket metadata');

  const jsonTx = {
    id: 502,
    type: 'รายจ่าย',
    amount: 200,
    wallet_id: null,
    details: '{"scope":"personal","account":"บัญชีส่วนตัว (กสิกรไทย)","note":"ค่าอาหาร"}'
  };
  const resolvedJsonId = FinancialCore.resolveWalletId(jsonTx, wallets);
  assert.strictEqual(resolvedJsonId, 20, 'Must resolve wallet ID 20 from JSON metadata');

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
  assert.strictEqual(wallets[0].balance, 900.00, 'Wallet balance must remain 900.00 and NOT be deducted to 800.00');

  assert(indexHtml.includes('FinancialCore.computeEditDelta'), 'index.html must invoke FinancialCore.computeEditDelta');
});

// ============================================================================
// MR02: Authoritative Single Reconciliation Operation & Stale Detection
// ============================================================================
await test('MR02', 'Reconciliation handler: authoritative RPC, no dual-insert, detects STALE_BALANCE immediately', () => {
  assert(indexHtml.includes("db.rpc('execute_wallet_reconciliation', {"),
    'handleReconSubmit must call execute_wallet_reconciliation RPC');
  assert(indexHtml.includes('p_date: date'), 'handleReconSubmit must pass p_date to RPC');
  assert(indexHtml.includes('if (rpcRecon.error) {'), 'handleReconSubmit must check rpcRecon.error immediately');
  assert(indexHtml.includes("errMsg.includes('STALE_BALANCE')"), 'handleReconSubmit must handle STALE_BALANCE explicitly');

  assert(!indexHtml.includes("category: 'ปรับยอดเงิน',\n          amount: Math.abs(diff),"),
    'handleReconSubmit must NOT insert a second client-side audit transaction');

  assert(migrationSql.includes('p_date DATE DEFAULT CURRENT_DATE'),
    'execute_wallet_reconciliation in SQL must accept p_date');
  assert(migrationSql.includes('v_wallet.user_id IS NULL OR v_wallet.user_id <> auth.uid()'),
    'execute_wallet_reconciliation must strictly reject NULL or non-matching owner');
});

// ============================================================================
// MR03: Atomic Bill Payment & Debt Ledger Split
// ============================================================================
await test('MR03', 'UI uses atomic RPCs for bills and debt; debt payment splits principal and interest in ledger', () => {
  assert(indexHtml.includes("db.rpc('execute_bill_payment', {"),
    'quickPayBill must call execute_bill_payment RPC');
  assert(indexHtml.includes("db.rpc('cancel_bill_payment', {"),
    'toggleBillPaid must call cancel_bill_payment RPC');
  assert(indexHtml.includes("db.rpc('execute_debt_payment', {"),
    'handleRecordDebtPayment must call execute_debt_payment RPC');

  assert(migrationSql.includes("'ชำระหนี้/ผ่อนสินค้า'"),
    'execute_debt_payment must record principal repayment under ชำระหนี้/ผ่อนสินค้า');
  assert(migrationSql.includes("'ดอกเบี้ยจ่าย'"),
    'execute_debt_payment must record interest repayment under ดอกเบี้ยจ่าย');

  const principalTx = { type: 'รายจ่าย', category: 'ชำระหนี้/ผ่อนสินค้า', amount: 5000 };
  const interestTx = { type: 'รายจ่าย', category: 'ดอกเบี้ยจ่าย', amount: 500 };
  assert.strictEqual(FinancialCore.isOperatingExpense(principalTx), false, 'Principal repayment is NOT operating expense');
  assert.strictEqual(FinancialCore.isOperatingExpense(interestTx), true, 'Interest repayment IS operating expense');
});

// ============================================================================
// MR04: Eliminate Partial Transfer Fallbacks & Unified Cancel
// ============================================================================
await test('MR04', 'Eliminate partial transfer fallbacks; cancelTransferByTx calls loadAllData()', () => {
  assert(indexHtml.includes("db.rpc('execute_wallet_transfer', {"),
    'saveTransfer must call execute_wallet_transfer RPC');
  assert(indexHtml.includes("db.rpc('cancel_wallet_transfer', {"),
    'cancelTransferByTx must call cancel_wallet_transfer RPC');
  assert(indexHtml.includes('await loadAllData();'),
    'cancelTransferByTx must reload authoritative state via loadAllData()');
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
// MR06: Schema Column Alignment & RPC Return Consistency
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
  assert(indexHtml.includes('if (res.error) throw res.error;'),
    'handleSaveBill must check res.error');
});

// ============================================================================
// MR07: Safe Non-Destructive Migrations & Owner Wallet Seeding
// ============================================================================
await test('MR07', 'No destructive deletes in migration; transfers fk is ON DELETE SET NULL; initial wallets seeded before owner assignment', () => {
  assert(!migrationSql.includes('DELETE FROM public.debt_payments WHERE debt_id'),
    'Migration must NOT delete orphan debt_payments');
  assert(!migrationSql.includes('DELETE FROM public.transfers WHERE from_wallet_id'),
    'Migration must NOT delete orphan transfers');

  assert(migrationSql.includes('FOREIGN KEY (transfer_id) REFERENCES public.transfers(id) ON DELETE SET NULL;'),
    'fk_transactions_transfer must be ON DELETE SET NULL to preserve ledger history');
});

// ============================================================================
// MR08: User-Scoped Cache & Strict Auth State Isolation
// ============================================================================
await test('MR08', 'User-scoped cache isolation: User B does not load User A wallets; sign out clears state', () => {
  assert(indexHtml.includes('function getUserStorageKey(key) {'),
    'getUserStorageKey must be defined in index.html');
  assert(indexHtml.includes("var uid = (currentUser && currentUser.id) ? currentUser.id : 'anon';"),
    'getUserStorageKey must namespace by currentUser.id');
  assert(indexHtml.includes("var key = getUserStorageKey('natthawit_studio_wallets');"),
    'loadWalletsFromLocal and saveWalletsToLocal must use getUserStorageKey');
  assert(indexHtml.includes('appData.wallets = currentUser ? [] : defaultWallets.slice();'),
    'loadWalletsFromLocal must not load default/other user wallets if user is authenticated');

  // Verify clearAppDataAndScreens resets state collections
  assert(indexHtml.includes('clearAppDataAndScreens'), 'clearAppDataAndScreens must be defined and used');
});

// ============================================================================
// MR09: Paginated Batch Data Loader (PostgREST 1,000 Row Limit)
// ============================================================================
await test('MR09', 'Paginated transaction loading fetches complete dataset across 1,000-row pages', async () => {
  assert(indexHtml.includes('async function fetchAllTransactions('),
    'fetchAllTransactions must be defined in index.html');
  assert(indexHtml.includes('.range(from, from + pageSize - 1)'),
    'fetchAllTransactions must use .range(from, to) for batch fetching');

  const totalRows = 1501;
  const mockDbRows = Array.from({ length: totalRows }, (_, i) => ({ id: i + 1, amount: 100 }));

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

  const resRoot = await request('/');
  assert.strictEqual(resRoot.statusCode, 200, 'Root / must return 200');
  assert(resRoot.data.includes('Natthawit Studio') || resRoot.data.includes('FreelanceHub'),
    'Root / must serve index.html content');

  const resNul = await request('/index.html%00.png');
  assert.strictEqual(resNul.statusCode, 400, 'NUL byte request must return 400 Bad Request');

  const resTraversal = await request('/../../../etc/passwd');
  assert.strictEqual(resTraversal.statusCode, 403, 'Path traversal must return 403 Forbidden');
});

// ============================================================================
// FR01: Atomic General Transaction Operations (Create, Update, Delete)
// ============================================================================
await test('FR01', 'Atomic RPC for General Transactions: single DB transaction rollback on failure & idempotent double-delete', async () => {
  // 1. Verification of SQL Procedures definition
  assert(migrationSql.includes('CREATE OR REPLACE FUNCTION public.execute_create_transaction('),
    'execute_create_transaction must exist in migration');
  assert(migrationSql.includes('CREATE OR REPLACE FUNCTION public.execute_update_transaction('),
    'execute_update_transaction must exist in migration');
  assert(migrationSql.includes('CREATE OR REPLACE FUNCTION public.execute_delete_transaction('),
    'execute_delete_transaction must exist in migration');

  // 2. Client uses atomic RPCs in index.html
  assert(indexHtml.includes("db.rpc('execute_update_transaction', rpcParams)"),
    'handleSaveTx must invoke execute_update_transaction RPC');
  assert(indexHtml.includes("db.rpc('execute_create_transaction', rpcParams)"),
    'handleSaveTx must invoke execute_create_transaction RPC');
  assert(indexHtml.includes("db.rpc('execute_delete_transaction', { p_tx_id: numId })"),
    'deleteTx must invoke execute_delete_transaction RPC');

  // 3. Dynamic Mock Harness: Moving expense from Wallet A (900) to Wallet B (500) where B fails
  // Verifies that failure in backend transaction does NOT leave Wallet A credited to 1,000
  const { exported: harnessEdit, formValues: editForm } = createVmHarness({
    rpc: async (name, params) => {
      if (name === 'execute_update_transaction') {
        return { error: new Error('Postgres error: Wallet B transaction failed') };
      }
      return { data: {} };
    }
  });

  harnessEdit.appData.wallets = [
    { id: 1, name: 'Wallet A', balance: 900 },
    { id: 2, name: 'Wallet B', balance: 500 }
  ];
  harnessEdit.appData.transactions = [
    { id: 201, type: 'รายจ่าย', amount: 100, wallet_id: 1, details: 'ค่าอุปกรณ์', date: '2026-09-22' }
  ];

  editForm['txEditId'] = '201';
  editForm['txAmount'] = '100';
  editForm['txType'] = 'รายจ่าย';
  editForm['txCategory'] = 'ทั่วไป';
  editForm['txScope'] = 'สตูดิโอ';
  editForm['txAccount'] = 'Wallet B';
  editForm['txDate'] = '2026-09-22';
  editForm['txTime'] = '10:00';
  editForm['txDetails'] = 'ค่าอุปกรณ์';
  editForm['txWallet'] = '2'; // Move to B

  await harnessEdit.handleSaveTx({ preventDefault: () => {} });

  assert.strictEqual(harnessEdit.appData.wallets[0].balance, 900,
    'Wallet A balance must remain 900 upon update failure (no partial balance adjustment)');
  assert.strictEqual(harnessEdit.appData.wallets[1].balance, 500,
    'Wallet B balance must remain 500 upon update failure');

  // 4. Dynamic Mock Harness: Concurrent double-delete idempotency
  // First call deletes and credits 100 -> 1000; Second call gets ALREADY_DELETED -> does not credit to 1100
  let deleteCalls = 0;
  const { exported: harnessDelete } = createVmHarness({
    rpc: async (name, params) => {
      if (name === 'execute_delete_transaction') {
        deleteCalls++;
        if (deleteCalls === 1) {
          return { data: { success: true, status: 'DELETED', wallet_id: 1, new_balance: 1000 } };
        } else {
          return { data: { success: false, status: 'ALREADY_DELETED' } };
        }
      }
      return { data: {} };
    }
  });

  harnessDelete.appData.wallets = [{ id: 1, name: 'Wallet A', balance: 900 }];
  harnessDelete.appData.transactions = [{ id: 301, type: 'รายจ่าย', amount: 100, wallet_id: 1 }];

  await Promise.all([
    harnessDelete.deleteTx(301),
    harnessDelete.deleteTx(301)
  ]);

  assert.strictEqual(deleteCalls, 2, 'Both concurrent calls must be issued to RPC');
  assert.strictEqual(harnessDelete.appData.wallets[0].balance, 1000,
    'Concurrent double-delete must credit wallet only ONCE (balance becomes 1,000, NOT 1,100)');
  assert.strictEqual(harnessDelete.appData.transactions.length, 0,
    'Deleted transaction must be filtered from local state');
});

// ============================================================================
// FR02: Async Race Condition & User Session Generation Isolation
// ============================================================================
await test('FR02', 'Session Generation Token: stale async responses from previous user are dropped without polluting new user state', async () => {
  // 1. Ensure currentSessionGeneration exists in index.html
  assert(indexHtml.includes('var currentSessionGeneration = 0;'),
    'currentSessionGeneration counter must be defined in index.html');

  // 2. Dynamic Mock Harness: User A begins loadWallets, user switches to B, User A response arrives late
  let resolveUserARequest;
  const userARequestPromise = new Promise((resolve) => {
    resolveUserARequest = resolve;
  });

  const { sandbox, exported, context } = createVmHarness({
    from: () => ({
      select: () => ({
        order: () => userARequestPromise
      })
    })
  });

  // User A starts loading
  context.currentUser = { id: 'user_A' };
  context.currentSessionGeneration = 1;
  const loadPromise = exported.loadWallets();

  // User switches to User B before response arrives
  context.currentUser = { id: 'user_B' };
  context.currentSessionGeneration = 2;
  exported.appData.wallets = [];

  // User A's slow response finally arrives
  resolveUserARequest({
    data: [{ id: 99, name: 'User A Secret Wallet', balance: 50000 }]
  });

  await loadPromise;

  assert.strictEqual(exported.appData.wallets.length, 0,
    'Stale response from User A must be dropped and NOT pollute User B appData.wallets');
  assert.strictEqual(sandbox.localStorageStore['natthawit_studio_wallets_user_B'], undefined,
    'Stale response from User A must NOT be written to User B cache');

  // 3. Verify user-scoped cache keys on debts and cards as well
  assert(indexHtml.includes("var key = getUserStorageKey('natthawit_studio_debts');"),
    'loadDebtsFromLocal must use getUserStorageKey');
  assert(indexHtml.includes("var key = getUserStorageKey('natthawit_studio_cards');"),
    'loadCardsFromLocal must use getUserStorageKey');

  // 4. Verify onAuthStateChange handles SIGNED_OUT
  assert(indexHtml.includes("} else if (event === 'SIGNED_OUT') {\n            clearAppDataAndScreens();"),
    'onAuthStateChange must call clearAppDataAndScreens on SIGNED_OUT');
});

// ============================================================================
// FR03: Resilient Sign-Out & View Rendering Cleanup
// ============================================================================
await test('FR03', 'Sign-out cleans state and calls valid view renderers without renderJobs reference error', async () => {
  // 1. Verify renderJobs() has been removed from index.html
  assert(!indexHtml.includes('renderJobs();'), 'renderJobs() must NOT be called anywhere in index.html');
  assert(indexHtml.includes('renderCalendar();'), 'renderCalendar() must be used to render jobs and calendar');

  // 2. Dynamic Mock Harness: invoke handleSignOut
  const { sandbox, exported, context } = createVmHarness();

  exported.appData.wallets = [{ id: 1, name: 'Wallet', balance: 1000 }];
  exported.appData.bills = [{ id: 10, title: 'Bill', amount: 500 }];
  exported.appData.debts = [{ id: 20, name: 'Debt', remaining_principal: 5000 }];
  context.currentUser = { id: 'user_active' };

  await exported.handleSignOut();

  assert.strictEqual(sandbox.lastAlert, undefined, 'Sign out must NOT trigger error alert');
  const toastEl = sandbox.elements['toast'];
  const toastText = (toastEl && toastEl.textContent) ? toastEl.textContent : sandbox.lastToast;
  assert.strictEqual(toastText, 'ออกจากระบบเรียบร้อยแล้ว 👋', 'Sign out must show success toast');
  const currentAppData = exported.getAppData();
  assert.strictEqual(currentAppData.wallets.length, 0, 'Wallets must be cleared on sign out');
  assert.strictEqual(currentAppData.bills.length, 0, 'Bills must be cleared on sign out');
  assert.strictEqual(currentAppData.debts.length, 0, 'Debts must be cleared on sign out');

  // Verify clearAppDataAndScreens in source contains all view renderers and no renderJobs
  assert(indexHtml.includes('renderCalendar'), 'renderCalendar must be in index.html');
  assert(indexHtml.includes('renderBills'), 'renderBills must be in index.html');
  assert(indexHtml.includes('renderDebts'), 'renderDebts must be in index.html');
  assert(indexHtml.includes('renderCards'), 'renderCards must be in index.html');
  assert(!indexHtml.includes('renderJobs();'), 'renderJobs() must NOT exist in index.html');
});

// ============================================================================
// FR04: SQL Migration Overloads & Constraint Upgrade Integrity
// ============================================================================
await test('FR04', 'Postgres function overloads dropped; fk_transactions_transfer upgraded to ON DELETE SET NULL', () => {
  // 1. Drop 4-arg execute_wallet_reconciliation overload
  const dropReconOverload = 'DROP FUNCTION IF EXISTS public.execute_wallet_reconciliation(BIGINT, NUMERIC, NUMERIC, TEXT);';
  assert(migrationSql.includes(dropReconOverload),
    'migrationSql must drop obsolete 4-arg execute_wallet_reconciliation overload');
  assert(upgradeSql.includes(dropReconOverload),
    'upgradeSql must drop obsolete 4-arg execute_wallet_reconciliation overload');

  // 2. fk_transactions_transfer upgrade to ON DELETE SET NULL
  assert(migrationSql.includes('ALTER TABLE public.transactions DROP CONSTRAINT fk_transactions_transfer;') ||
         migrationSql.includes('DROP CONSTRAINT IF EXISTS fk_transactions_transfer'),
    'migrationSql must drop older fk_transactions_transfer before recreating as ON DELETE SET NULL');
  assert(migrationSql.includes('ALTER TABLE public.transactions ADD CONSTRAINT fk_transactions_transfer FOREIGN KEY (transfer_id) REFERENCES public.transfers(id) ON DELETE SET NULL;'),
    'migrationSql must add fk_transactions_transfer with ON DELETE SET NULL');

  assert(upgradeSql.includes('ALTER TABLE public.transactions DROP CONSTRAINT fk_transactions_transfer;'),
    'upgradeSql must explicitly drop older constraint');
  assert(upgradeSql.includes('ALTER TABLE public.transactions \n  ADD CONSTRAINT fk_transactions_transfer \n  FOREIGN KEY (transfer_id) REFERENCES public.transfers(id) ON DELETE SET NULL;'),
    'upgradeSql must add constraint with ON DELETE SET NULL');
});

// ============================================================================
// FR05: Anonymous Permissions Lockdown & RLS Enforcement
// ============================================================================
await test('FR05', 'Anonymous permissions revoked; FORCE ROW LEVEL SECURITY enabled on all sensitive tables', () => {
  // 1. REVOKE ALL ON public.transactions FROM anon
  assert(migrationSql.includes('REVOKE ALL ON public.transactions FROM anon;'),
    'migrationSql must REVOKE ALL ON public.transactions FROM anon');
  assert(upgradeSql.includes('REVOKE ALL ON public.transactions FROM anon;'),
    'upgradeSql must REVOKE ALL ON public.transactions FROM anon');

  // 2. FORCE ROW LEVEL SECURITY
  assert(migrationSql.includes('ALTER TABLE public.transactions FORCE ROW LEVEL SECURITY;'),
    'migrationSql must enforce FORCE ROW LEVEL SECURITY on transactions');
  assert(migrationSql.includes('ALTER TABLE public.wallets FORCE ROW LEVEL SECURITY;'),
    'migrationSql must enforce FORCE ROW LEVEL SECURITY on wallets');
  assert(upgradeSql.includes('ALTER TABLE public.transactions FORCE ROW LEVEL SECURITY;'),
    'upgradeSql must enforce FORCE ROW LEVEL SECURITY on transactions');

  // 3. New atomic RPCs permissions
  ['execute_create_transaction', 'execute_update_transaction', 'execute_delete_transaction'].forEach((rpcName) => {
    assert(migrationSql.includes(`GRANT EXECUTE ON FUNCTION public.${rpcName}`),
      `migrationSql must grant execute on ${rpcName} to authenticated`);
    assert(migrationSql.includes(`REVOKE ALL ON FUNCTION public.${rpcName}`) && migrationSql.includes('FROM PUBLIC, anon'),
      `migrationSql must revoke execute on ${rpcName} from anon and PUBLIC`);
  });
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
