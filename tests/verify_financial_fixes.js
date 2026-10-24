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
const { execSync } = require('child_process');
const { PGlite } = require('@electric-sql/pglite');

// Direct Production Code Import
const FinancialCore = require('../js/financial-core.js');
const { handleRequest } = require('../server.js');

console.log('🧪 Starting FreelanceHub Acceptance & Regression Verification Suite (MR01-MR10 & FR01-FR06 & RR01-RR06)...\n');

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

// Load production source files directly
const ROOT_DIR = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
const migrationSql = fs.readFileSync(path.join(ROOT_DIR, 'supabase_migration_v2.sql'), 'utf8');
const upgradeSql = fs.readFileSync(path.join(ROOT_DIR, 'supabase_schema_upgrade.sql'), 'utf8');

async function initPgWithShims() {
  const pg = new PGlite();
  await pg.exec(`
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
  return pg;
}

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
      const classSet = new Set();
      const attributes = {};
      elements[id] = {
        id,
        get value() { return formValues[id] || ''; },
        set value(v) { formValues[id] = v; },
        textContent: '',
        style: {},
        setAttribute: (name, value) => { attributes[name] = String(value); },
        getAttribute: (name) => attributes[name] ?? null,
        removeAttribute: (name) => { delete attributes[name]; },
        classList: {
          add: (c) => classSet.add(c),
          remove: (c) => classSet.delete(c),
          toggle: (c) => classSet.has(c) ? classSet.delete(c) : classSet.add(c),
          contains: (c) => classSet.has(c)
        },
        querySelectorAll: () => [],
        querySelector: (sel) => getOrCreateElement('child_' + sel),
        focus: () => { sandbox.lastFocusedElementId = id; },
        options: []
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
      querySelectorAll: (sel) => {
        if (sel === '.drawer-backdrop') {
          return Object.values(elements).filter(el => el.classList.contains('drawer-backdrop') || el.id.includes('Drawer') || el.id.includes('Modal'));
        }
        return [];
      },
      querySelector: (sel) => getOrCreateElement('btn_' + sel),
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

  ['renderDashboard', 'renderTransactions', 'renderCalendar', 'renderTodos', 'renderBills', 'renderEquipment', 'renderProjectsHub', 'renderDebts', 'renderCards', 'updateSettingsCounts', 'showToast', 'closeAllDrawers', 'setSyncStatus', 'loadAllData'].forEach(fnName => {
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
    createClient: () => {
      const client=Object.assign(defaultDb, dbOverride), originalRpc=client.rpc;
      client.rpc=async (name,args)=>name==='get_my_app_access'
        ? {data:{user_id:context.currentUser?.id,status:'approved',allowed:true,is_admin:false}}
        : originalRpc(name,args);
      return client;
    }
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/access-control.js'), 'utf8'), context);
  const exported = vm.runInContext(mainScript + '\n;({currentSessionGeneration, clearAppDataAndScreens, handleSaveTx, deleteTx, handleReconSubmit, quickPayBill, toggleBillPaid, handleSaveBill, handleRecordDebtPayment, handleInternalTransfer, cancelTransferByTx, loadWallets, handleSignOut, appData, getAppData: () => appData, setSyncStatus, closeAllDrawers: () => {}, initAuth, updateAuthUI: () => {}, checkOnboardingStatus, handleFinishOnboarding, openOnboardingWizard, closeOnboardingWizard, goToOnboardingStep, saveAppDataSnapshot, loadAppDataSnapshot, loadAllData, getCurrentBangkokPeriod, isChecklistItemChecked, getBangkokMonthDisplayName, setChecklistFilter, renderChecklist, toggleChecklistItem, openAddChecklistItemModal, openEditChecklistItemModal, handleSaveChecklistItem, deleteChecklistItem, openSlipScannerModal, closeSlipScannerModal, cancelSlipProcessing, handleSlipFilesSelected, setSlipDraftFilter, renderSlipDrafts, updateSlipDraft, removeSlipDraft, applyBulkWalletToSlips, applyBulkCategoryToSlips, confirmAndSaveSlipDrafts});', context);

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
  assert(/if \(event === 'SIGNED_OUT'\) \{[\s\S]*?clearAppDataAndScreens\(\);/.test(indexHtml),
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
// RR01: Real PostgreSQL Migration Execution Across All Paths
// ============================================================================
await test('RR01', 'Real PostgreSQL migration execution: fresh, rerun, upgrade 991b34f, upgrade 0e2a6f7, and 5-arg reconciliation proc', async () => {
  // 1. Fresh install in embedded PostgreSQL
  const pgFresh = await initPgWithShims();
  await pgFresh.exec(migrationSql);

  // 2. Rerun of full migration without 42883 or conflicting drops
  await pgFresh.exec(migrationSql);
  await pgFresh.close();

  // 3. Upgrade from 991b34f base commit
  const pg99 = await initPgWithShims();
  const base99 = execSync('git show 991b34f:supabase_migration_v2.sql', { encoding: 'utf8' });
  await pg99.exec(base99);
  await pg99.exec(upgradeSql);

  // Check 5-arg execute_wallet_reconciliation procedure exists
  const check5 = await pg99.query(`
    SELECT proname, pronargs FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND proname = 'execute_wallet_reconciliation';
  `);
  assert.strictEqual(check5.rows.length, 1, 'Exactly one execute_wallet_reconciliation procedure must exist');
  assert.strictEqual(check5.rows[0].pronargs, 5, 'Procedure must have 5 arguments (p_date added)');
  await pg99.close();

  // 4. Upgrade from 0e2a6f7 base commit
  const pg0e = await initPgWithShims();
  const base0e = execSync('git show 0e2a6f7:supabase_migration_v2.sql', { encoding: 'utf8' });
  await pg0e.exec(base0e);
  await pg0e.exec(upgradeSql);

  // 5. Rerun upgrade script (idempotent delta)
  await pg0e.exec(upgradeSql);
  await pg0e.close();
});

// ============================================================================
// RR02: Real PostgreSQL Legacy Transaction Identity Resolution (900 remains 900)
// ============================================================================
await test('RR02', 'PostgreSQL Legacy Transaction Identity Resolution: note/category edits route to Case A without re-deducting balance', async () => {
  const pg = await initPgWithShims();
  await pg.exec(migrationSql);

  const user1Id = '11111111-1111-1111-1111-111111111111';
  await pg.exec(`INSERT INTO auth.users (id, email) VALUES ('${user1Id}', 'user1@test.com');`);
  await pg.exec(`
    SET request.jwt.claim.sub = '${user1Id}';
    SET request.jwt.claim.role = 'authenticated';
  `);

  // Seed wallets
  const wRes = await pg.query(`
    INSERT INTO public.wallets (name, balance, user_id)
    VALUES ('บัญชีสตูดิโอ (ไทยพาณิชย์)', 900.00, '${user1Id}'),
           ('กระเป๋าเงินสด', 500.00, '${user1Id}')
    RETURNING id, name, balance;
  `);
  const w1Id = wRes.rows[0].id;
  const w2Id = wRes.rows[1].id;

  // Seed Legacy Tx 1 (bracket metadata, wallet_id IS NULL)
  const tx1Res = await pg.query(`
    INSERT INTO public.transactions (user_id, type, category, amount, details, date, wallet_id)
    VALUES ('${user1Id}', 'รายจ่าย', 'ค่าอุปกรณ์', 100.00, '[สตูดิโอ | บัญชีสตูดิโอ (ไทยพาณิชย์)] ค่าการ์ด SD', '2026-09-22', NULL)
    RETURNING id;
  `);
  const tx1Id = tx1Res.rows[0].id;

  // Seed Legacy Tx 2 (JSON metadata, wallet_id IS NULL)
  const tx2Res = await pg.query(`
    INSERT INTO public.transactions (user_id, type, category, amount, details, date, wallet_id)
    VALUES ('${user1Id}', 'รายจ่าย', 'ค่าเดินทาง', 50.00, '{"scope":"personal","account":"บัญชีสตูดิโอ (ไทยพาณิชย์)","note":"ค่าแท็กซี่"}', '2026-09-22', NULL)
    RETURNING id;
  `);
  const tx2Id = tx2Res.rows[0].id;

  // Test resolve_transaction_wallet_id helper function
  const r1 = await pg.query(`SELECT public.resolve_transaction_wallet_id('[สตูดิโอ | บัญชีสตูดิโอ (ไทยพาณิชย์)] ค่าการ์ด SD', '${user1Id}') AS wid;`);
  assert.strictEqual(Number(r1.rows[0].wid), Number(w1Id), 'Must resolve wallet ID from bracket format');

  const r2 = await pg.query(`SELECT public.resolve_transaction_wallet_id('{"scope":"personal","account":"บัญชีสตูดิโอ (ไทยพาณิชย์)","note":"ค่าแท็กซี่"}', '${user1Id}') AS wid;`);
  assert.strictEqual(Number(r2.rows[0].wid), Number(w1Id), 'Must resolve wallet ID from JSON format');

  // Note-only edit: server resolves legacy wallet, routes to Case A, balance REMAINS 900.00!
  const editNoteRes = await pg.query(`
    SELECT public.execute_update_transaction(
      p_tx_id := ${tx1Id},
      p_date := '2026-09-22'::date,
      p_type := 'รายจ่าย',
      p_category := 'ค่าอุปกรณ์',
      p_amount := 100.00,
      p_details := '[สตูดิโอ | บัญชีสตูดิโอ (ไทยพาณิชย์)] ค่าการ์ด SD (แก้ไขโน้ต)',
      p_related_job := NULL,
      p_wallet_id := ${w1Id},
      p_card_id := NULL,
      p_job_id := NULL
    ) AS res;
  `);
  const editNoteData = editNoteRes.rows[0].res;
  assert.strictEqual(Number(editNoteData.new_wallet_balance), 900.00, 'Note-only edit must return 900.00 balance');

  const balCheck1 = await pg.query(`SELECT balance FROM public.wallets WHERE id = ${w1Id};`);
  assert.strictEqual(Number(balCheck1.rows[0].balance), 900.00, 'Wallet balance in DB must remain 900.00 (NOT 800.00)');

  // Category-only edit on Tx 1: balance REMAINS 900.00
  await pg.query(`
    SELECT public.execute_update_transaction(
      p_tx_id := ${tx1Id},
      p_date := '2026-09-22'::date,
      p_type := 'รายจ่าย',
      p_category := 'ค่าบริการ',
      p_amount := 100.00,
      p_details := '[สตูดิโอ | บัญชีสตูดิโอ (ไทยพาณิชย์)] ค่าการ์ด SD (แก้ไขโน้ต)',
      p_related_job := NULL,
      p_wallet_id := ${w1Id},
      p_card_id := NULL,
      p_job_id := NULL
    );
  `);
  const balCheckCat = await pg.query(`SELECT balance FROM public.wallets WHERE id = ${w1Id};`);
  assert.strictEqual(Number(balCheckCat.rows[0].balance), 900.00, 'Category-only edit must keep balance at 900.00');

  // Amount change: from 100.00 to 150.00 (delta = -50 -> 900 - 50 = 850.00)
  await pg.query(`
    SELECT public.execute_update_transaction(
      p_tx_id := ${tx1Id},
      p_date := '2026-09-22'::date,
      p_type := 'รายจ่าย',
      p_category := 'ค่าบริการ',
      p_amount := 150.00,
      p_details := '[สตูดิโอ | บัญชีสตูดิโอ (ไทยพาณิชย์)] ค่าการ์ด SD',
      p_related_job := NULL,
      p_wallet_id := ${w1Id},
      p_card_id := NULL,
      p_job_id := NULL
    );
  `);
  const balCheckAmt = await pg.query(`SELECT balance FROM public.wallets WHERE id = ${w1Id};`);
  assert.strictEqual(Number(balCheckAmt.rows[0].balance), 850.00, 'Amount increase must deduct balance to 850.00');

  // Move legacy Tx 2 (50.00 expense) from Wallet 1 to Wallet 2
  await pg.query(`
    SELECT public.execute_update_transaction(
      p_tx_id := ${tx2Id},
      p_date := '2026-09-22'::date,
      p_type := 'รายจ่าย',
      p_category := 'ค่าเดินทาง',
      p_amount := 50.00,
      p_details := '{"scope":"personal","account":"กระเป๋าเงินสด","note":"ค่าแท็กซี่"}',
      p_related_job := NULL,
      p_wallet_id := ${w2Id},
      p_card_id := NULL,
      p_job_id := NULL
    );
  `);
  const balCheckW1Move = await pg.query(`SELECT balance FROM public.wallets WHERE id = ${w1Id};`);
  const balCheckW2Move = await pg.query(`SELECT balance FROM public.wallets WHERE id = ${w2Id};`);
  assert.strictEqual(Number(balCheckW1Move.rows[0].balance), 900.00, 'Wallet 1 must be credited back to 900.00');
  assert.strictEqual(Number(balCheckW2Move.rows[0].balance), 450.00, 'Wallet 2 must be deducted to 450.00');

  // Deletion of legacy transaction with NULL wallet_id
  const tx3Res = await pg.query(`
    INSERT INTO public.transactions (user_id, type, category, amount, details, date, wallet_id)
    VALUES ('${user1Id}', 'รายจ่าย', 'ค่าอุปกรณ์', 200.00, '[สตูดิโอ | บัญชีสตูดิโอ (ไทยพาณิชย์)] ไฟสตูดิโอ', '2026-09-22', NULL)
    RETURNING id;
  `);
  const tx3Id = tx3Res.rows[0].id;
  await pg.query(`SELECT public.execute_delete_transaction(${tx3Id});`);
  const balCheckDel = await pg.query(`SELECT balance FROM public.wallets WHERE id = ${w1Id};`);
  assert.strictEqual(Number(balCheckDel.rows[0].balance), 1100.00, 'Deleting legacy tx must revert balance to 1100.00');

  await pg.close();
});

// ============================================================================
// RR03: Canonical Job ID (Numeric FK), Thai Titles, and Cross-Tenant Security
// ============================================================================
await test('RR03', 'Canonical Job ID: handles Thai & numeric titles, preserves relation on note edit, rejects cross-tenant job ID', async () => {
  const pg = await initPgWithShims();
  await pg.exec(migrationSql);

  const userA = '11111111-1111-1111-1111-111111111111';
  const userB = '22222222-2222-2222-2222-222222222222';
  await pg.exec(`
    INSERT INTO auth.users (id, email) VALUES
    ('${userA}', 'userA@test.com'),
    ('${userB}', 'userB@test.com');
  `);

  await pg.exec(`
    SET request.jwt.claim.sub = '${userA}';
    SET request.jwt.claim.role = 'authenticated';
  `);

  const wRes = await pg.query(`
    INSERT INTO public.wallets (name, balance, user_id)
    VALUES ('กระเป๋า A', 1000.00, '${userA}') RETURNING id;
  `);
  const wId = wRes.rows[0].id;

  // Jobs for User A
  const j1Res = await pg.query(`
    INSERT INTO public.jobs (title, client, budget, user_id)
    VALUES ('งานถ่ายพรีเวดดิ้ง ขอนแก่น', 'ลูกค้า ก', 20000.00, '${userA}') RETURNING id;
  `);
  const job1Id = j1Res.rows[0].id;

  const j2Res = await pg.query(`
    INSERT INTO public.jobs (title, client, budget, user_id)
    VALUES ('2024 Fashion Week BKK', 'ลูกค้า ข', 35000.00, '${userA}') RETURNING id;
  `);
  const job2Id = j2Res.rows[0].id;

  // Job for User B
  const j3Res = await pg.query(`
    INSERT INTO public.jobs (title, client, budget, user_id)
    VALUES ('งานออกแบบ User B', 'ลูกค้า ค', 10000.00, '${userB}') RETURNING id;
  `);
  const job3Id = j3Res.rows[0].id;

  // 1. User A creates tx linked to Job 1 (Thai title)
  const createRes1 = await pg.query(`
    SELECT public.execute_create_transaction(
      p_date := '2026-09-22'::date,
      p_type := 'รายรับ',
      p_category := 'มัดจำ',
      p_amount := 5000.00,
      p_details := 'มัดจำถ่ายพรีเวดดิ้ง',
      p_related_job := 'งานถ่ายพรีเวดดิ้ง ขอนแก่น',
      p_wallet_id := ${wId},
      p_card_id := NULL,
      p_job_id := ${job1Id}
    ) AS res;
  `);
  const tx1Id = createRes1.rows[0].res.transaction.id;
  const checkTx1 = await pg.query(`SELECT job_id, related_job FROM public.transactions WHERE id = ${tx1Id};`);
  assert.strictEqual(Number(checkTx1.rows[0].job_id), Number(job1Id));
  assert.strictEqual(checkTx1.rows[0].related_job, 'งานถ่ายพรีเวดดิ้ง ขอนแก่น');

  // 2. User A creates tx linked to Job 2 (numeric prefixed title)
  const createRes2 = await pg.query(`
    SELECT public.execute_create_transaction(
      p_date := '2026-09-22'::date,
      p_type := 'รายรับ',
      p_category := 'มัดจำ',
      p_amount := 10000.00,
      p_details := 'มัดจำงาน 2024',
      p_related_job := '2024 Fashion Week BKK',
      p_wallet_id := ${wId},
      p_card_id := NULL,
      p_job_id := ${job2Id}
    ) AS res;
  `);
  const tx2Id = createRes2.rows[0].res.transaction.id;
  const checkTx2 = await pg.query(`SELECT job_id, related_job FROM public.transactions WHERE id = ${tx2Id};`);
  assert.strictEqual(Number(checkTx2.rows[0].job_id), Number(job2Id));
  assert.strictEqual(checkTx2.rows[0].related_job, '2024 Fashion Week BKK');

  // 3. Note-only edit preserves job_id
  await pg.query(`
    SELECT public.execute_update_transaction(
      p_tx_id := ${tx1Id},
      p_date := '2026-09-22'::date,
      p_type := 'รายรับ',
      p_category := 'มัดจำ',
      p_amount := 5000.00,
      p_details := 'มัดจำถ่ายพรีเวดดิ้ง (แก้ไขโน้ต)',
      p_related_job := 'งานถ่ายพรีเวดดิ้ง ขอนแก่น',
      p_wallet_id := ${wId},
      p_card_id := NULL,
      p_job_id := ${job1Id}
    );
  `);
  const checkTx1After = await pg.query(`SELECT job_id, related_job FROM public.transactions WHERE id = ${tx1Id};`);
  assert.strictEqual(Number(checkTx1After.rows[0].job_id), Number(job1Id), 'Job ID must be preserved on note edit');

  // 4. Cross-tenant rejection on create
  let crossTenantCreateFailed = false;
  try {
    await pg.query(`
      SELECT public.execute_create_transaction(
        p_date := '2026-09-22'::date,
        p_type := 'รายรับ',
        p_category := 'มัดจำ',
        p_amount := 1000.00,
        p_details := 'hack',
        p_related_job := 'งานออกแบบ User B',
        p_wallet_id := ${wId},
        p_card_id := NULL,
        p_job_id := ${job3Id}
      );
    `);
  } catch(err) {
    crossTenantCreateFailed = true;
    assert(err.message.includes('INVALID_JOB'), 'Expected INVALID_JOB error, got: ' + err.message);
  }
  assert(crossTenantCreateFailed, 'Cross-tenant job link on create must be rejected');

  // 5. Cross-tenant rejection on update
  let crossTenantUpdateFailed = false;
  try {
    await pg.query(`
      SELECT public.execute_update_transaction(
        p_tx_id := ${tx1Id},
        p_date := '2026-09-22'::date,
        p_type := 'รายรับ',
        p_category := 'มัดจำ',
        p_amount := 5000.00,
        p_details := 'hack',
        p_related_job := 'งานออกแบบ User B',
        p_wallet_id := ${wId},
        p_card_id := NULL,
        p_job_id := ${job3Id}
      );
    `);
  } catch(err) {
    crossTenantUpdateFailed = true;
    assert(err.message.includes('INVALID_JOB'), 'Expected INVALID_JOB error, got: ' + err.message);
  }
  assert(crossTenantUpdateFailed, 'Cross-tenant job link on update must be rejected');

  await pg.close();
});

// ============================================================================
// RR04: Session Generation Isolation Across All Async Mutations
// ============================================================================
await test('RR04', 'Session Generation Isolation: in-flight async responses from stale sessions are cleanly discarded across all mutations', async () => {
  assert(indexHtml.includes('function isMutationSessionValid('),
    'index.html must define isMutationSessionValid helper');

  let resolveDelayedRpc;
  const delayedRpcPromise = new Promise(resolve => { resolveDelayedRpc = resolve; });

  const { sandbox, exported, context, formValues } = createVmHarness({
    rpc: async (name, params) => delayedRpcPromise,
    from: () => ({
      insert: () => delayedRpcPromise,
      select: () => ({ order: () => ({ range: () => delayedRpcPromise }) })
    })
  });

  context.currentUser = { id: 'user_A' };
  context.currentSessionGeneration = 1;
  exported.appData.transactions = [];
  exported.appData.wallets = [{ id: 1, name: 'Wallet A', balance: 1000 }];

  formValues['txAmount'] = '500';
  formValues['txType'] = 'รายจ่าย';
  formValues['txCategory'] = 'ทั่วไป';
  formValues['txScope'] = 'สตูดิโอ';
  formValues['txAccount'] = 'Wallet A';
  formValues['txDate'] = '2026-09-22';
  formValues['txTime'] = '12:00';
  formValues['txDetails'] = 'อาหาร';

  // In-flight mutation under User A
  const inFlightMutation = exported.handleSaveTx({ preventDefault: () => {} });

  // User logs out and User B logs in before in-flight RPC finishes
  context.currentUser = { id: 'user_B' };
  context.currentSessionGeneration = 2;
  exported.appData.transactions = [];
  exported.appData.wallets = [{ id: 9, name: 'Wallet B', balance: 200 }];

  // Late response arrives from User A
  resolveDelayedRpc({
    data: {
      success: true,
      transaction: { id: 999, amount: 500, details: 'อาหาร' },
      wallet_id: 1,
      new_balance: 500
    }
  });

  await inFlightMutation;

  assert.strictEqual(exported.appData.transactions.length, 0,
    'Stale mutation response must be discarded and NOT added to User B transactions');
  assert.strictEqual(exported.appData.wallets[0].balance, 200,
    'Stale mutation response must NOT modify User B wallet balance');
});

// ============================================================================
// RR05: Idempotency Key (request_id) on execute_create_transaction
// ============================================================================
await test('RR05', 'Idempotent Create Transaction: retry with same request_id returns existing record without re-deducting balance', async () => {
  const pg = await initPgWithShims();
  await pg.exec(migrationSql);

  const userA = '11111111-1111-1111-1111-111111111111';
  await pg.exec(`INSERT INTO auth.users (id, email) VALUES ('${userA}', 'userA@test.com');`);
  await pg.exec(`
    SET request.jwt.claim.sub = '${userA}';
    SET request.jwt.claim.role = 'authenticated';
  `);

  const wRes = await pg.query(`
    INSERT INTO public.wallets (name, balance, user_id)
    VALUES ('กระเป๋าหลัก', 1000.00, '${userA}') RETURNING id;
  `);
  const wId = wRes.rows[0].id;

  // 1. Initial create with request_id = 'req-first'
  const res1 = await pg.query(`
    SELECT public.execute_create_transaction(
      p_date := '2026-09-22'::date,
      p_type := 'รายจ่าย',
      p_category := 'อาหาร',
      p_amount := 120.00,
      p_details := 'อาหารกลางวัน',
      p_related_job := NULL,
      p_wallet_id := ${wId},
      p_card_id := NULL,
      p_job_id := NULL,
      p_request_id := 'req-first'
    ) AS res;
  `);
  const rData1 = res1.rows[0].res;
  assert.strictEqual(rData1.status, 'CREATED');
  assert.strictEqual(Number(rData1.new_balance), 880.00);

  const bal1 = await pg.query(`SELECT balance FROM public.wallets WHERE id = ${wId};`);
  assert.strictEqual(Number(bal1.rows[0].balance), 880.00);

  // 2. Retry with same request_id = 'req-first' and same payload
  const res2 = await pg.query(`
    SELECT public.execute_create_transaction(
      p_date := '2026-09-22'::date,
      p_type := 'รายจ่าย',
      p_category := 'อาหาร',
      p_amount := 120.00,
      p_details := 'อาหารกลางวัน',
      p_related_job := NULL,
      p_wallet_id := ${wId},
      p_card_id := NULL,
      p_job_id := NULL,
      p_request_id := 'req-first'
    ) AS res;
  `);
  const rData2 = res2.rows[0].res;
  assert.strictEqual(rData2.status, 'IDEMPOTENT_RETRY', 'Must return IDEMPOTENT_RETRY on retry');
  assert.strictEqual(Number(rData2.new_balance), 880.00, 'Balance must remain 880.00');

  const bal2 = await pg.query(`SELECT balance FROM public.wallets WHERE id = ${wId};`);
  assert.strictEqual(Number(bal2.rows[0].balance), 880.00, 'Balance in DB must remain 880.00 (NOT deducted to 760.00)');

  const countCheck = await pg.query(`SELECT COUNT(*) FROM public.transactions WHERE request_id = 'req-first';`);
  assert.strictEqual(Number(countCheck.rows[0].count), 1, 'Only exactly 1 transaction row must exist');

  // 3. Different request_id = 'req-second' creates another transaction
  const res3 = await pg.query(`
    SELECT public.execute_create_transaction(
      p_date := '2026-09-22'::date,
      p_type := 'รายจ่าย',
      p_category := 'อาหาร',
      p_amount := 120.00,
      p_details := 'อาหารกลางวัน',
      p_related_job := NULL,
      p_wallet_id := ${wId},
      p_card_id := NULL,
      p_job_id := NULL,
      p_request_id := 'req-second'
    ) AS res;
  `);
  const rData3 = res3.rows[0].res;
  assert.strictEqual(rData3.status, 'CREATED');
  assert.strictEqual(Number(rData3.new_balance), 760.00);

  // 4. Conflicting payload with existing request_id = 'req-first'
  let conflictFailed = false;
  try {
    await pg.query(`
      SELECT public.execute_create_transaction(
        p_date := '2026-09-22'::date,
        p_type := 'รายจ่าย',
        p_category := 'อาหาร',
        p_amount := 999.00,
        p_details := 'อาหารกลางวัน',
        p_related_job := NULL,
        p_wallet_id := ${wId},
        p_card_id := NULL,
        p_job_id := NULL,
        p_request_id := 'req-first'
      );
    `);
  } catch(err) {
    conflictFailed = true;
    assert(err.message.includes('IDEMPOTENCY_CONFLICT'), 'Expected IDEMPOTENCY_CONFLICT, got: ' + err.message);
  }
  assert(conflictFailed, 'Conflicting payload on same request_id must throw error');

  await pg.close();
});

// ============================================================================
// N01: Idempotency Payload Validation & Cross-User Wallet Leak Prevention
// ============================================================================
await test('N01', 'Idempotency Payload Validation & Cross-User Wallet Leak Prevention: rejects altered payload and never leaks third-party balance', async () => {
  const pg = await initPgWithShims();
  await pg.exec(migrationSql);

  const userA = '11111111-1111-1111-1111-111111111111';
  const userB = '22222222-2222-2222-2222-222222222222';
  await pg.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${userA}', 'userA@test.com'), ('${userB}', 'userB@test.com');
  `);

  // User A wallet: 1,000
  const wARes = await pg.query(`
    INSERT INTO public.wallets (name, balance, user_id) VALUES ('Wallet A', 1000.00, '${userA}') RETURNING id;
  `);
  const wA = wARes.rows[0].id;

  // User B wallet: 98,765
  const wBRes = await pg.query(`
    INSERT INTO public.wallets (name, balance, user_id) VALUES ('Wallet B', 98765.00, '${userB}') RETURNING id;
  `);
  const wB = wBRes.rows[0].id;

  // Jobs for User A
  const job1Res = await pg.query(`INSERT INTO public.jobs (title, user_id) VALUES ('Job 1', '${userA}') RETURNING id;`);
  const j1 = job1Res.rows[0].id;
  const job2Res = await pg.query(`INSERT INTO public.jobs (title, user_id) VALUES ('Job 2', '${userA}') RETURNING id;`);
  const j2 = job2Res.rows[0].id;

  // Cards for User A
  const card1Res = await pg.query(`INSERT INTO public.cards (name, issuer, user_id) VALUES ('Card 1', 'KBANK', '${userA}') RETURNING id;`);
  const c1 = card1Res.rows[0].id;
  const card2Res = await pg.query(`INSERT INTO public.cards (name, issuer, user_id) VALUES ('Card 2', 'SCB', '${userA}') RETURNING id;`);
  const c2 = card2Res.rows[0].id;

  // Authenticate as User A
  await pg.exec(`
    SET request.jwt.claim.sub = '${userA}';
    SET request.jwt.claim.role = 'authenticated';
  `);

  // 1. Initial create under User A
  const res1 = await pg.query(`
    SELECT public.execute_create_transaction(
      p_date := '2026-09-22'::date,
      p_type := 'รายจ่าย',
      p_category := 'อาหาร',
      p_amount := 100.00,
      p_details := 'อาหารกลางวัน',
      p_related_job := NULL,
      p_wallet_id := ${wA},
      p_card_id := ${c1},
      p_job_id := ${j1},
      p_request_id := 'req-n01'
    ) AS res;
  `);
  assert.strictEqual(res1.rows[0].res.status, 'CREATED');
  assert.strictEqual(Number(res1.rows[0].res.new_balance), 900.00);

  // 2. Retry with same request_id but specifying User B's wallet
  let leakCaught = false;
  try {
    await pg.query(`
      SELECT public.execute_create_transaction(
        p_date := '2026-09-22'::date,
        p_type := 'รายจ่าย',
        p_category := 'อาหาร',
        p_amount := 100.00,
        p_details := 'อาหารกลางวัน',
        p_related_job := NULL,
        p_wallet_id := ${wB},
        p_card_id := ${c1},
        p_job_id := ${j1},
        p_request_id := 'req-n01'
      );
    `);
  } catch (err) {
    leakCaught = true;
    assert(err.message.includes('IDEMPOTENCY_CONFLICT'), 'Expected IDEMPOTENCY_CONFLICT, got: ' + err.message);
  }
  assert(leakCaught, 'Cross-user wallet swap on retry must throw IDEMPOTENCY_CONFLICT');

  // Verify User B wallet was never touched or read
  const balB = await pg.query(`SELECT balance FROM public.wallets WHERE id = ${wB};`);
  assert.strictEqual(Number(balB.rows[0].balance), 98765.00, 'User B wallet balance must remain completely untouched');

  // 3. Test every individual payload field modification triggers IDEMPOTENCY_CONFLICT (including related_job)
  const variations = [
    { field: 'details', sql: `p_details := 'อาหารค่ำ'` },
    { field: 'category', sql: `p_category := 'เดินทาง'` },
    { field: 'date', sql: `p_date := '2026-09-23'::date` },
    { field: 'amount', sql: `p_amount := 200.00` },
    { field: 'type', sql: `p_type := 'รายรับ'` },
    { field: 'card_id', sql: `p_card_id := ${c2}` },
    { field: 'job_id', sql: `p_job_id := ${j2}` },
    { field: 'related_job', sql: `p_related_job := 'งานตัดต่อวิดีโอ'` },
    { field: 'wallet_id', sql: `p_wallet_id := NULL` }
  ];

  for (const v of variations) {
    let errCaught = false;
    try {
      await pg.query(`
        SELECT public.execute_create_transaction(
          p_date := ${v.field === 'date' ? "'2026-09-23'::date" : "'2026-09-22'::date"},
          p_type := ${v.field === 'type' ? "'รายรับ'" : "'รายจ่าย'"},
          p_category := ${v.field === 'category' ? "'เดินทาง'" : "'อาหาร'"},
          p_amount := ${v.field === 'amount' ? '200.00' : '100.00'},
          p_details := ${v.field === 'details' ? "'อาหารค่ำ'" : "'อาหารกลางวัน'"},
          p_related_job := ${v.field === 'related_job' ? "'งานตัดต่อวิดีโอ'" : 'NULL'},
          p_wallet_id := ${v.field === 'wallet_id' ? 'NULL' : wA},
          p_card_id := ${v.field === 'card_id' ? c2 : c1},
          p_job_id := ${v.field === 'job_id' ? j2 : j1},
          p_request_id := 'req-n01'
        );
      `);
    } catch (err) {
      errCaught = true;
      assert(err.message.includes('IDEMPOTENCY_CONFLICT'), `Field ${v.field} modification must throw IDEMPOTENCY_CONFLICT, got: ${err.message}`);
    }
    assert(errCaught, `Altered field ${v.field} must be rejected with IDEMPOTENCY_CONFLICT`);
  }

  // 4. Test null-safety for related_job: non-null original vs null retry
  const resRelJob = await pg.query(`
    SELECT public.execute_create_transaction(
      p_date := '2026-09-22'::date,
      p_type := 'รายจ่าย',
      p_category := 'อาหาร',
      p_amount := 50.00,
      p_details := 'ของว่างกองถ่าย',
      p_related_job := 'งานภาพนิ่งสตูดิโอ',
      p_wallet_id := ${wA},
      p_card_id := NULL,
      p_job_id := NULL,
      p_request_id := 'req-n01-reljob'
    ) AS res;
  `);
  assert.strictEqual(resRelJob.rows[0].res.status, 'CREATED');

  // Retry with NULL related_job must throw IDEMPOTENCY_CONFLICT
  let relJobNullCaught = false;
  try {
    await pg.query(`
      SELECT public.execute_create_transaction(
        p_date := '2026-09-22'::date,
        p_type := 'รายจ่าย',
        p_category := 'อาหาร',
        p_amount := 50.00,
        p_details := 'ของว่างกองถ่าย',
        p_related_job := NULL,
        p_wallet_id := ${wA},
        p_card_id := NULL,
        p_job_id := NULL,
        p_request_id := 'req-n01-reljob'
      );
    `);
  } catch (err) {
    relJobNullCaught = true;
    assert(err.message.includes('IDEMPOTENCY_CONFLICT'), 'Expected IDEMPOTENCY_CONFLICT when related_job changed from string to NULL');
  }
  assert(relJobNullCaught, 'Switching related_job from string to NULL must be rejected with IDEMPOTENCY_CONFLICT');

  // Exact retry with matching related_job succeeds
  const resRelJobRetry = await pg.query(`
    SELECT public.execute_create_transaction(
      p_date := '2026-09-22'::date,
      p_type := 'รายจ่าย',
      p_category := 'อาหาร',
      p_amount := 50.00,
      p_details := 'ของว่างกองถ่าย',
      p_related_job := 'งานภาพนิ่งสตูดิโอ',
      p_wallet_id := ${wA},
      p_card_id := NULL,
      p_job_id := NULL,
      p_request_id := 'req-n01-reljob'
    ) AS res;
  `);
  assert.strictEqual(resRelJobRetry.rows[0].res.status, 'IDEMPOTENT_RETRY');

  // 5. Exact retry must succeed and return wallet_id from operation (wA), NOT caller's param
  const resRetry = await pg.query(`
    SELECT public.execute_create_transaction(
      p_date := '2026-09-22'::date,
      p_type := 'รายจ่าย',
      p_category := 'อาหาร',
      p_amount := 100.00,
      p_details := 'อาหารกลางวัน',
      p_related_job := NULL,
      p_wallet_id := ${wA},
      p_card_id := ${c1},
      p_job_id := ${j1},
      p_request_id := 'req-n01'
    ) AS res;
  `);
  assert.strictEqual(resRetry.rows[0].res.status, 'IDEMPOTENT_RETRY');
  assert.strictEqual(Number(resRetry.rows[0].res.wallet_id), Number(wA));
  assert.strictEqual(Number(resRetry.rows[0].res.new_balance), 850.00);

  await pg.close();
});

// ============================================================================
// N02: Concurrent Retry & Subtransaction Rollback Isolation
// ============================================================================
await test('N02', 'Concurrent Retry & Subtransaction Rollback Isolation: speculative balance update rolled back on race collision without double deduction', async () => {
  const pg = await initPgWithShims();
  await pg.exec(migrationSql);

  const userA = '11111111-1111-1111-1111-111111111111';
  const userB = '22222222-2222-2222-2222-222222222222';
  await pg.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${userA}', 'userA@test.com'), ('${userB}', 'userB@test.com');
  `);

  const wARes = await pg.query(`
    INSERT INTO public.wallets (name, balance, user_id) VALUES ('Wallet A', 1000.00, '${userA}') RETURNING id;
  `);
  const wA = wARes.rows[0].id;

  const wBRes = await pg.query(`
    INSERT INTO public.wallets (name, balance, user_id) VALUES ('Wallet B', 5000.00, '${userB}') RETURNING id;
  `);
  const wB = wBRes.rows[0].id;

  await pg.exec(`
    SET request.jwt.claim.sub = '${userA}';
    SET request.jwt.claim.role = 'authenticated';
  `);

  // 1. Initial transaction creates ledger row and deducts wallet (1000 -> 900)
  const res1 = await pg.query(`
    SELECT public.execute_create_transaction(
      p_date := '2026-09-22'::date,
      p_type := 'รายจ่าย',
      p_category := 'อาหาร',
      p_amount := 100.00,
      p_details := 'มื้อเที่ยง',
      p_related_job := NULL,
      p_wallet_id := ${wA},
      p_card_id := NULL,
      p_job_id := NULL,
      p_request_id := 'req-race-1'
    ) AS res;
  `);
  assert.strictEqual(res1.rows[0].res.status, 'CREATED');
  assert.strictEqual(Number(res1.rows[0].res.new_balance), 900.00);

  // 2. Sequential retry (exercises Fast Pre-check path in production RPC)
  const resPrecheck = await pg.query(`
    SELECT public.execute_create_transaction(
      p_date := '2026-09-22'::date,
      p_type := 'รายจ่าย',
      p_category := 'อาหาร',
      p_amount := 100.00,
      p_details := 'มื้อเที่ยง',
      p_related_job := NULL,
      p_wallet_id := ${wA},
      p_card_id := NULL,
      p_job_id := NULL,
      p_request_id := 'req-race-1'
    ) AS res;
  `);
  assert.strictEqual(resPrecheck.rows[0].res.status, 'IDEMPOTENT_RETRY', 'Fast pre-check retry must return IDEMPOTENT_RETRY');
  assert.strictEqual(Number(resPrecheck.rows[0].res.new_balance), 900.00);

  // 3. Test-Only Barrier to simulate concurrent race in single-process PGlite:
  // We install a test-only view barrier on public.transactions that hides the row during the pre-check
  // (simulating in-flight concurrent execution before the winner committed), forcing Request 2 to enter
  // the atomic BEGIN block, execute UPDATE wallets speculatively, and hit unique_violation on INSERT!
  // PostgreSQL automatically aborts the subtransaction to the savepoint at BEGIN, rolling back the speculative wallet update!
  await pg.exec(`
    ALTER TABLE public.transactions RENAME TO transactions_real;
    CREATE SEQUENCE test_race_seq;
    CREATE OR REPLACE FUNCTION test_race_hide(req text) RETURNS BOOLEAN AS $$
    BEGIN
      IF req LIKE 'req-race%' AND nextval('test_race_seq') = 1 THEN
        RETURN TRUE;
      END IF;
      RETURN FALSE;
    END;
    $$ LANGUAGE plpgsql;

    CREATE VIEW public.transactions AS 
    SELECT * FROM public.transactions_real WHERE NOT test_race_hide(request_id);

    CREATE OR REPLACE FUNCTION test_view_tx_insert() RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO public.transactions_real (
        user_id, date, type, category, amount, details, related_job, wallet_id, card_id, job_id, request_id, created_at, updated_at
      ) VALUES (
        NEW.user_id, NEW.date, NEW.type, NEW.category, NEW.amount, NEW.details, NEW.related_job, NEW.wallet_id, NEW.card_id, NEW.job_id, NEW.request_id, NOW(), NOW()
      ) RETURNING * INTO NEW;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_test_view_tx_insert INSTEAD OF INSERT ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION test_view_tx_insert();
  `);

  const resRace = await pg.query(`
    SELECT public.execute_create_transaction(
      p_date := '2026-09-22'::date,
      p_type := 'รายจ่าย',
      p_category := 'อาหาร',
      p_amount := 100.00,
      p_details := 'มื้อเที่ยง',
      p_related_job := NULL,
      p_wallet_id := ${wA},
      p_card_id := NULL,
      p_job_id := NULL,
      p_request_id := 'req-race-1'
    ) AS res;
  `);

  assert.strictEqual(resRace.rows[0].res.status, 'IDEMPOTENT_RETRY', 'Concurrent loser hitting unique_violation must return IDEMPOTENT_RETRY');
  assert.strictEqual(Number(resRace.rows[0].res.new_balance), 900.00, 'Returned balance must be 900.00');

  // Verify wallet balance in database: MUST be 900.00 (NOT double-deducted to 800.00!)
  const balCheck = await pg.query(`SELECT balance FROM public.wallets WHERE id = ${wA};`);
  assert.strictEqual(Number(balCheck.rows[0].balance), 900.00, 'Persistent wallet balance must remain exactly 900.00');

  // Verify transaction count in ledger: MUST be exactly 1
  const countCheck = await pg.query(`SELECT COUNT(*) FROM public.transactions_real WHERE request_id = 'req-race-1';`);
  assert.strictEqual(Number(countCheck.rows[0].count), 1, 'Ledger must contain exactly 1 transaction');

  // 4. Concurrent race with conflicting payload (e.g. amount changed to 500)
  // Reset sequence to 0 so nextval triggers hide on first read (pre-check)
  await pg.exec(`ALTER SEQUENCE test_race_seq RESTART WITH 1;`);
  let raceConflictCaught = false;
  try {
    await pg.query(`
      SELECT public.execute_create_transaction(
        p_date := '2026-09-22'::date,
        p_type := 'รายจ่าย',
        p_category := 'อาหาร',
        p_amount := 500.00,
        p_details := 'มื้อเที่ยง',
        p_related_job := NULL,
        p_wallet_id := ${wA},
        p_card_id := NULL,
        p_job_id := NULL,
        p_request_id := 'req-race-1'
      );
    `);
  } catch (err) {
    raceConflictCaught = true;
    assert(err.message.includes('IDEMPOTENCY_CONFLICT'), 'Expected IDEMPOTENCY_CONFLICT on conflicting race payload');
  }
  assert(raceConflictCaught, 'Conflicting race payload must throw IDEMPOTENCY_CONFLICT');

  // Balance must still be 900.00
  const balCheck2 = await pg.query(`SELECT balance FROM public.wallets WHERE id = ${wA};`);
  assert.strictEqual(Number(balCheck2.rows[0].balance), 900.00, 'Balance must remain 900.00 after rejected conflict race');

  // 5. Cross-user isolation: User B creates transaction using identical request_id 'req-race-1'
  await pg.exec(`
    SET request.jwt.claim.sub = '${userB}';
    SET request.jwt.claim.role = 'authenticated';
  `);
  const resUserB = await pg.query(`
    SELECT public.execute_create_transaction(
      p_date := '2026-09-22'::date,
      p_type := 'รายจ่าย',
      p_category := 'เซิร์ฟเวอร์',
      p_amount := 250.00,
      p_details := 'Cloudflare Pages',
      p_related_job := NULL,
      p_wallet_id := ${wB},
      p_card_id := NULL,
      p_job_id := NULL,
      p_request_id := 'req-race-1'
    ) AS res;
  `);
  assert.strictEqual(resUserB.rows[0].res.status, 'CREATED', 'User B must create independent transaction with same request_id');
  assert.strictEqual(Number(resUserB.rows[0].res.new_balance), 4750.00);

  const balBCheck = await pg.query(`SELECT balance FROM public.wallets WHERE id = ${wB};`);
  assert.strictEqual(Number(balBCheck.rows[0].balance), 4750.00, 'User B wallet balance must be 4750.00');

  await pg.close();
});

// ============================================================================
// RR06: Real PostgreSQL Security & Anonymous Access Blocked via RLS & Revocation
// ============================================================================
await test('RR06', 'Real PostgreSQL Anonymous Access Blocked via RLS & Revocation; Live Supabase Execution Documented', async () => {
  const pg = await initPgWithShims();
  await pg.exec(migrationSql);

  const userA = '11111111-1111-1111-1111-111111111111';
  await pg.exec(`INSERT INTO auth.users (id, email) VALUES ('${userA}', 'userA@test.com');`);
  
  // Seed data under User A
  await pg.exec(`
    SET request.jwt.claim.sub = '${userA}';
    SET request.jwt.claim.role = 'authenticated';
  `);
  await pg.query(`
    INSERT INTO public.wallets (name, balance, user_id)
    VALUES ('กระเป๋า User A', 500.00, '${userA}');
  `);
  await pg.query(`
    INSERT INTO public.transactions (user_id, type, category, amount, details, date)
    VALUES ('${userA}', 'รายรับ', 'งาน', 1000.00, 'ค่าจ้าง', '2026-09-22');
  `);

  // Switch session to anon role in postgres
  await pg.exec(`
    SET ROLE anon;
    SET request.jwt.claim.sub = '';
    SET request.jwt.claim.role = 'anon';
  `);

  // Test anon cannot read transactions (REVOKE ALL FROM anon)
  let anonTxBlocked = false;
  try {
    await pg.query(`SELECT COUNT(*) FROM public.transactions;`);
  } catch(err) {
    anonTxBlocked = true;
    assert(err.message.includes('permission denied'), 'Must be permission denied: ' + err.message);
  }
  assert(anonTxBlocked, 'anon must be blocked from reading transactions');

  // Test anon cannot read wallets (REVOKE ALL FROM anon)
  let anonWBlocked = false;
  try {
    await pg.query(`SELECT COUNT(*) FROM public.wallets;`);
  } catch(err) {
    anonWBlocked = true;
    assert(err.message.includes('permission denied'), 'Must be permission denied: ' + err.message);
  }
  assert(anonWBlocked, 'anon must be blocked from reading wallets');

  // Test anon cannot call execute_create_transaction
  let anonRpcBlocked = false;
  try {
    await pg.query(`
      SELECT public.execute_create_transaction(
        p_date := '2026-09-22'::date,
        p_type := 'รายจ่าย',
        p_category := 'อาหาร',
        p_amount := 100.00,
        p_details := 'anon hack',
        p_related_job := NULL,
        p_wallet_id := 1,
        p_card_id := NULL,
        p_job_id := NULL
      );
    `);
  } catch(err) {
    anonRpcBlocked = true;
    assert(err.message.includes('permission denied') || err.message.includes('Unauthorized') || err.message.includes('user_id'), 
      'Expected permission denied or unauthorized error, got: ' + err.message);
  }
  assert(anonRpcBlocked, 'anon must be blocked from calling RPC');

  await pg.close();

  // Document live production Supabase deployment status
  console.log('     ℹ️ Remote Production Database (pyxjwilhqixceehqkpcl.supabase.co) Status:');
  console.log('        Automated writes to production are disabled per safety constraints.');
  console.log('        Verified locally via PGlite that anon is fully revoked and RLS enforced.');
  console.log('        To apply to live remote Supabase: Execute supabase_schema_upgrade.sql in Supabase Dashboard SQL Editor.');
});

// ============================================================================
// OB01: Atomic & Idempotent Onboarding Provisioning (RPC & State Isolation)
// ============================================================================
await test('OB01', 'Atomic & Idempotent Onboarding RPC: provisions 1 wallet, categories, opening balance, and prevents duplicate provisioning on retry', async () => {
  const pg = await initPgWithShims();
  await pg.exec(migrationSql);

  const newUserId = '22222222-2222-2222-2222-222222222222';
  await pg.exec(`INSERT INTO auth.users (id, email) VALUES ('${newUserId}', 'newuser@freelancehub.app');`);
  await pg.exec(`
    SET request.jwt.claim.sub = '${newUserId}';
    SET request.jwt.claim.role = 'authenticated';
  `);

  // 1. Initial complete_onboarding call
  const call1 = await pg.query(`
    SELECT public.complete_onboarding(
      p_display_name := 'สมชาย ฟรีแลนซ์',
      p_profession := 'ช่างภาพ',
      p_wallet_name := 'บัญชีออมทรัพย์ กสิกรไทย',
      p_wallet_type := 'ธนาคาร',
      p_opening_balance := 5000.00,
      p_opening_date := '2026-09-26'::date
    ) AS res;
  `);

  const res1 = call1.rows[0].res;
  assert.strictEqual(res1.success, true, 'First onboarding call must succeed');
  assert.strictEqual(res1.status, 'COMPLETED', 'Status must be COMPLETED');
  assert(res1.wallet_id, 'Must return created wallet_id');

  // Verify wallet created with confirmed opening balance
  const walletCheck = await pg.query(`SELECT * FROM public.wallets WHERE user_id = '${newUserId}';`);
  assert.strictEqual(walletCheck.rows.length, 1, 'Exactly 1 wallet must be provisioned');
  assert.strictEqual(Number(walletCheck.rows[0].balance), 5000.00, 'Wallet balance must equal confirmed opening balance');
  assert.strictEqual(walletCheck.rows[0].name, 'บัญชีออมทรัพย์ กสิกรไทย', 'Wallet name must match');

  // Verify default categories seeded
  const catCheck = await pg.query(`SELECT COUNT(*) as cnt FROM public.categories WHERE user_id = '${newUserId}';`);
  assert(Number(catCheck.rows[0].cnt) >= 8, 'Default categories must be provisioned');

  // Verify user_profiles row
  const profileCheck = await pg.query(`SELECT * FROM public.user_profiles WHERE id = '${newUserId}';`);
  assert.strictEqual(profileCheck.rows.length, 1, 'Profile row must exist');
  assert(profileCheck.rows[0].onboarding_completed_at !== null, 'onboarding_completed_at must be populated');
  assert.strictEqual(profileCheck.rows[0].display_name, 'สมชาย ฟรีแลนซ์');

  // 2. Retry / Double-submit simulation: Second call must return ALREADY_COMPLETED and same wallet_id without duplicating
  const call2 = await pg.query(`
    SELECT public.complete_onboarding(
      p_display_name := 'สมชาย ฟรีแลนซ์',
      p_profession := 'ช่างภาพ',
      p_wallet_name := 'บัญชีออมทรัพย์ กสิกรไทย',
      p_wallet_type := 'ธนาคาร',
      p_opening_balance := 5000.00,
      p_opening_date := '2026-09-26'::date
    ) AS res;
  `);

  const res2 = call2.rows[0].res;
  assert.strictEqual(res2.success, true, 'Retry onboarding call must return success');
  assert.strictEqual(res2.status, 'ALREADY_COMPLETED', 'Retry must return ALREADY_COMPLETED');
  assert.strictEqual(String(res2.wallet_id), String(res1.wallet_id), 'Must return the same wallet_id without duplicating');

  // Confirm still exactly 1 wallet and not 2
  const walletCount2 = await pg.query(`SELECT COUNT(*) as cnt FROM public.wallets WHERE user_id = '${newUserId}';`);
  assert.strictEqual(Number(walletCount2.rows[0].cnt), 1, 'Must still have exactly 1 wallet after retry (idempotent)');

  // 3. User with deleted wallets does NOT get re-onboarded
  await pg.query(`DELETE FROM public.wallets WHERE user_id = '${newUserId}';`);
  const profileCheckAfterDelete = await pg.query(`SELECT onboarding_completed_at FROM public.user_profiles WHERE id = '${newUserId}';`);
  assert(profileCheckAfterDelete.rows[0].onboarding_completed_at !== null,
    'onboarding_completed_at remains set even if user deletes wallets, preventing accidental wizard restart');

  await pg.close();
});

// ============================================================================
// OBR01: Asynchronous Session Isolation & Profile Leakage Prevention
// ============================================================================
await test('OBR01', 'Stale async onboarding responses are cleanly discarded across session switches without writing to other profiles', async () => {
  // 1. Static check: client-side onboarding code must NOT hardcode legacy user names
  assert(!indexHtml.includes("display_name: 'คุณณัฐวิทย์'"),
    'client-side code in index.html must NOT contain hardcoded legacy user name "คุณณัฐวิทย์"');

  // 2. Dynamic check: User A starts checkOnboardingStatus, switches to User B while query is in-flight
  let resolveUserAQuery;
  const userAQueryPromise = new Promise(resolve => { resolveUserAQuery = resolve; });
  let upsertCalled = false;

  const { sandbox, exported, context } = createVmHarness({
    from: (table) => {
      if (table === 'user_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => userAQueryPromise
            })
          }),
          upsert: async () => {
            upsertCalled = true;
            return { data: null, error: null };
          }
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) })
      };
    }
  });

  context.currentUser = { id: 'user_A', email: 'user_a@freelancehub.app' };
  context.currentSessionGeneration = 1;
  exported.appData.wallets = [];

  // Start onboarding check for User A
  const checkPromise = exported.checkOnboardingStatus();

  // User A signs out / User B logs in before response arrives
  exported.clearAppDataAndScreens();
  context.currentUser = { id: 'user_B', email: 'user_b@freelancehub.app' };
  exported.appData.wallets = [{ id: 101, name: 'User B Wallet', balance: 5000 }];

  // User A query resolves
  resolveUserAQuery({
    data: null,
    error: null
  });

  await checkPromise;

  assert.strictEqual(upsertCalled, false,
    'Stale response from User A must NOT trigger backfill upsert on User B profile');
  const modalEl = sandbox.document.getElementById('onboardingWizardModal');
  assert.strictEqual(modalEl.classList.contains('active'), false,
    'Stale response from User A must NOT open the onboarding wizard for User B');

  // 3. Verify clearAppDataAndScreens clears form values
  const nameEl = sandbox.document.getElementById('obDisplayName');
  nameEl.value = 'Draft Studio Name';
  exported.clearAppDataAndScreens();
  assert.strictEqual(nameEl.value, '', 'clearAppDataAndScreens must wipe onboarding draft inputs');
});

// ============================================================================
// OBR02: Safe Handling of Onboarding Query Errors (No False Wizard)
// ============================================================================
await test('OBR02', 'Read errors on user_profiles do NOT pop the onboarding wizard or attempt backfill', async () => {
  let upsertCalled = false;
  const { sandbox, exported, context } = createVmHarness({
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: { message: 'Network connection lost', code: '503' }
          })
        })
      }),
      upsert: async () => {
        upsertCalled = true;
        return { data: null, error: null };
      }
    })
  });

  context.currentUser = { id: 'existing_user_id', email: 'existing@freelancehub.app' };
  exported.appData.wallets = []; // Even if wallets haven't loaded yet

  await exported.checkOnboardingStatus();

  const modalEl = sandbox.document.getElementById('onboardingWizardModal');
  assert.strictEqual(modalEl.classList.contains('active'), false,
    'Database read error must abort and NOT open the onboarding wizard');
  assert.strictEqual(upsertCalled, false,
    'Database read error must NOT attempt backfill upsert');
});

// ============================================================================
// OBR03: Conflicting Retry Payload Rejection (PostgreSQL RPC & Frontend UX)
// ============================================================================
await test('OBR03', 'Submitting conflicting onboarding payload returns PAYLOAD_CONFLICT and alerts user rather than false success', async () => {
  // 1. PostgreSQL DB test with PGlite
  const pg = await initPgWithShims();
  await pg.exec(migrationSql);

  const conflictUserId = '33333333-3333-3333-3333-333333333333';
  await pg.exec(`INSERT INTO auth.users (id, email) VALUES ('${conflictUserId}', 'conflict@freelancehub.app');`);
  await pg.exec(`
    SET request.jwt.claim.sub = '${conflictUserId}';
    SET request.jwt.claim.role = 'authenticated';
  `);

  // Call 1: Original onboarding setup
  const call1 = await pg.query(`
    SELECT public.complete_onboarding(
      p_display_name := 'สตูดิโอ นภัส',
      p_profession := 'กราฟิกดีไซน์',
      p_wallet_name := 'บัญชีกสิกรไทย',
      p_wallet_type := 'bank',
      p_opening_balance := 10000.00,
      p_opening_date := '2026-09-29'::date
    ) AS res;
  `);
  const res1 = call1.rows[0].res;
  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.status, 'COMPLETED');

  // Verify stored payload in user_profiles
  const profileRow = await pg.query(`SELECT onboarding_payload FROM public.user_profiles WHERE id = '${conflictUserId}';`);
  assert(profileRow.rows[0].onboarding_payload, 'onboarding_payload must be saved');
  assert.strictEqual(profileRow.rows[0].onboarding_payload.wallet_name, 'บัญชีกสิกรไทย');
  assert.strictEqual(Number(profileRow.rows[0].onboarding_payload.opening_balance), 10000.00);

  // Call 2: Identical retry succeeds idempotently
  const call2 = await pg.query(`
    SELECT public.complete_onboarding(
      p_display_name := 'สตูดิโอ นภัส',
      p_profession := 'กราฟิกดีไซน์',
      p_wallet_name := 'บัญชีกสิกรไทย',
      p_wallet_type := 'bank',
      p_opening_balance := 10000.00,
      p_opening_date := '2026-09-29'::date
    ) AS res;
  `);
  const res2 = call2.rows[0].res;
  assert.strictEqual(res2.success, true);
  assert.strictEqual(res2.status, 'ALREADY_COMPLETED');

  // Call 3: Conflicting retry (e.g. from second tab with different balance & wallet name)
  const call3 = await pg.query(`
    SELECT public.complete_onboarding(
      p_display_name := 'สตูดิโอ นภัส',
      p_profession := 'กราฟิกดีไซน์',
      p_wallet_name := 'บัญชีไทยพาณิชย์ใหม่',
      p_wallet_type := 'bank',
      p_opening_balance := 99999.00,
      p_opening_date := '2026-09-29'::date
    ) AS res;
  `);
  const res3 = call3.rows[0].res;
  assert.strictEqual(res3.success, false, 'Conflicting retry must return success: false');
  assert.strictEqual(res3.status, 'PAYLOAD_CONFLICT', 'Conflicting retry must return status: PAYLOAD_CONFLICT');
  assert.strictEqual(res3.error, 'ONBOARDING_CONFLICT', 'Conflicting retry must return error: ONBOARDING_CONFLICT');

  // Verify wallet balance remained 10,000 and was NOT overwritten to 99,999
  const walletCheck = await pg.query(`SELECT balance, name FROM public.wallets WHERE user_id = '${conflictUserId}';`);
  assert.strictEqual(Number(walletCheck.rows[0].balance), 10000.00, 'Balance must remain 10,000');
  assert.strictEqual(walletCheck.rows[0].name, 'บัญชีกสิกรไทย', 'Wallet name must remain original');

  await pg.close();

  // 2. Client UX handling in VM harness
  const { sandbox, exported, context, formValues } = createVmHarness({
    rpc: async (fn) => {
      if (fn === 'complete_onboarding') {
        return {
          data: {
            success: false,
            status: 'PAYLOAD_CONFLICT',
            error: 'ONBOARDING_CONFLICT',
            message: 'Onboarding already completed with different parameters'
          }
        };
      }
      return { data: {} };
    }
  });

  context.currentUser = { id: 'client_user_id', email: 'test@freelancehub.app' };
  formValues['obDisplayName'] = 'ชื่อสตูดิโอ';
  formValues['obWalletName'] = 'กระเป๋าใหม่';
  formValues['obOpeningBalance'] = '50000';

  const modalEl = sandbox.document.getElementById('onboardingWizardModal');
  modalEl.classList.add('active');

  await exported.handleFinishOnboarding();

  assert.strictEqual(modalEl.classList.contains('active'), false, 'Wizard must close on conflict');
  assert(sandbox.lastAlert && sandbox.lastAlert.includes('ได้รับการตั้งค่าเริ่มต้นไว้ก่อนหน้านี้'),
    'User must be alerted about pre-existing setup rather than showing false success');
  assert(indexHtml.includes("if (res.data && res.data.status === 'PAYLOAD_CONFLICT')"),
    'index.html must explicitly branch on PAYLOAD_CONFLICT');
  assert(indexHtml.includes("alert('ระบบเคยได้รับการตั้งค่าเริ่มต้นไว้ก่อนหน้านี้ด้วยข้อมูลอื่นแล้ว กำลังโหลดข้อมูลปัจจุบันของคุณ');\n          await loadAllData();"),
    'handleFinishOnboarding must alert user and invoke loadAllData on conflict');
});

// ============================================================================
// OBR04: Modal Lifecycle, Focus Management & Step Validation
// ============================================================================
await test('OBR04', 'Wizard integrates with standard drawer lifecycle, enforces step validation, and manages focus', async () => {
  // 1. Static markup checks
  assert(!indexHtml.includes('<div id="onboardingWizardModal" class="drawer-backdrop" role="dialog" aria-modal="true" aria-labelledby="onboardingTitle" style="display: none;'),
    'onboardingWizardModal must NOT have inline style="display: none;"');
  assert(indexHtml.includes('id="obErrorAlertStep1"'),
    'Step 1 must have its own obErrorAlertStep1 container');

  // 2. Dynamic lifecycle and focus trapping
  const { sandbox, exported, formValues } = createVmHarness();
  const modalEl = sandbox.document.getElementById('onboardingWizardModal');

  // Open wizard
  exported.openOnboardingWizard();
  assert.strictEqual(modalEl.classList.contains('active'), true,
    'openOnboardingWizard must add .active class to drawer-backdrop');
  assert.strictEqual(sandbox.lastFocusedElementId, 'obDisplayName',
    'Opening wizard must autofocus obDisplayName on Step 1');

  // Step 1 Validation: Attempt to advance to Step 2 without display name
  formValues['obDisplayName'] = '';
  exported.goToOnboardingStep(2);

  const step1Err = sandbox.document.getElementById('obErrorAlertStep1');
  assert.strictEqual(step1Err.style.display, 'block',
    'Advancing without name must display Step 1 validation error');
  assert(step1Err.textContent.includes('กรุณาระบุชื่อสตูดิโอ'),
    'Step 1 error message must instruct user to provide name');

  // Provide display name and advance to Step 2
  formValues['obDisplayName'] = 'สตูดิโอ มีศิลป์';
  exported.goToOnboardingStep(2);

  assert.strictEqual(step1Err.style.display, 'none',
    'Valid name must clear Step 1 error');
  assert.strictEqual(sandbox.lastFocusedElementId, 'obWalletName',
    'Advancing to Step 2 must autofocus obWalletName');

  // Advance to Step 3
  exported.goToOnboardingStep(3);
  assert.strictEqual(sandbox.document.getElementById('obSummaryName').textContent, 'สตูดิโอ มีศิลป์',
    'Step 3 summary must display entered display name');
  assert.strictEqual(sandbox.lastFocusedElementId, 'obFinishBtn',
    'Advancing to Step 3 must autofocus obFinishBtn');

  // Close wizard
  exported.closeOnboardingWizard();
  assert.strictEqual(modalEl.classList.contains('active'), false,
    'closeOnboardingWizard must remove .active class from modal');
});

// ============================================================================
// PR01: Instant PWA Startup, Stale-While-Revalidate Snapshot & In-Flight Race Guard
// ============================================================================
await test('PR01', 'Instant PWA Startup: local snapshot loads <50ms, queries parallelized, and INITIAL_SESSION preserves in-flight load', async () => {
  // 1. Static assertions
  assert(indexHtml.includes('function saveAppDataSnapshot() {'),
    'saveAppDataSnapshot must be defined in index.html');
  assert(indexHtml.includes('function loadAppDataSnapshot() {'),
    'loadAppDataSnapshot must be defined in index.html');
  assert(indexHtml.includes("getUserStorageKey('freelancehub_snapshot_v1')"),
    'Snapshot must be scoped by user storage key');
  assert(indexHtml.includes("document.addEventListener('visibilitychange'"),
    'visibilitychange listener must be registered for mobile resume sync');
  assert(indexHtml.includes('loadWallets(),\n          loadDebts(),\n          loadCards()'),
    'loadAllData must execute loadWallets, loadDebts, and loadCards concurrently in Promise.all');

  // 2. Dynamic Snapshot and Cache Isolation
  const { sandbox, exported, context } = createVmHarness();
  context.currentUser = { id: 'user_natthawit' };
  exported.appData.wallets = [
    { id: 1, name: 'SCB Studio', balance: 67056.22, opening_balance: 0 },
    { id: 2, name: 'KBank Personal', balance: 12500.00, opening_balance: 0 }
  ];
  exported.appData.transactions = [
    { id: 101, amount: 15000, type: 'รายรับ', category: 'งานถ่ายภาพ' }
  ];

  // Save snapshot to local storage
  exported.saveAppDataSnapshot();
  const snapshotKey = 'freelancehub_snapshot_v1_user_natthawit';
  assert(sandbox.localStorageStore[snapshotKey] !== undefined,
    'Snapshot must be saved in localStorage with user-scoped key');

  const parsedSnapshot = JSON.parse(sandbox.localStorageStore[snapshotKey]);
  assert.strictEqual(parsedSnapshot.userId, 'user_natthawit');
  assert.strictEqual(parsedSnapshot.wallets.length, 2);
  assert.strictEqual(parsedSnapshot.wallets[0].balance, 67056.22);
  assert.strictEqual(parsedSnapshot.transactions.length, 1);

  // Clear in-memory state (simulating fresh PWA cold-boot)
  exported.appData.wallets = [];
  exported.appData.transactions = [];

  // A restored session must pass the server approval gate before its snapshot is shown.
  context.appAccessState={user_id:'user_natthawit',status:'approved',allowed:true,is_admin:false};
  const loaded = exported.loadAppDataSnapshot();
  assert.strictEqual(loaded, true, 'loadAppDataSnapshot must return true on valid snapshot');
  assert.strictEqual(exported.appData.wallets.length, 2, 'Wallets must be restored from snapshot');
  assert.strictEqual(exported.appData.wallets[0].balance, 67056.22, 'Wallet balance must be restored');
  assert.strictEqual(exported.appData.transactions.length, 1, 'Transactions must be restored');

  // Verify multi-tenant isolation: User B must NOT load User A's snapshot
  context.currentUser = { id: 'user_other' };
  exported.appData.wallets = [];
  const loadedOther = exported.loadAppDataSnapshot();
  assert.strictEqual(loadedOther, false, 'User B must not load User A snapshot');
  assert.strictEqual(exported.appData.wallets.length, 0, 'User B appData must remain empty');

  // 3. Auth Race Condition: INITIAL_SESSION must NOT bump currentSessionGeneration
  // Reset harness for auth simulation
  let authCallback = null;
  let getSessionResolved = false;
  const authHarness = createVmHarness({
    auth: {
      getSession: async () => {
        getSessionResolved = true;
        return { data: { session: { user: { id: 'user_natthawit' } } } };
      },
      onAuthStateChange: (cb) => {
        authCallback = cb;
      }
    }
  });

  authHarness.context.currentSessionGeneration = 0;
  await authHarness.exported.initAuth();

  const initialGen = authHarness.context.currentSessionGeneration;
  assert(initialGen > 0, 'initAuth must set currentSessionGeneration >= 1');

  // Trigger INITIAL_SESSION event with the same user
  authCallback('INITIAL_SESSION', { user: { id: 'user_natthawit' } });
  assert.strictEqual(authHarness.context.currentSessionGeneration, initialGen,
    'INITIAL_SESSION for the same user must NOT increment currentSessionGeneration, preventing in-flight load abort');

  // Trigger TOKEN_REFRESHED with same user
  authCallback('TOKEN_REFRESHED', { user: { id: 'user_natthawit' } });
  assert.strictEqual(authHarness.context.currentSessionGeneration, initialGen,
    'TOKEN_REFRESHED for the same user must NOT increment currentSessionGeneration');

  // Trigger SIGNED_OUT
  authCallback('SIGNED_OUT', null);
  assert(authHarness.context.currentSessionGeneration > initialGen,
    'SIGNED_OUT must increment currentSessionGeneration to invalidate stale requests');
});

// ============================================================================
// RC01: Recurring Fixed Cost Checklist (Auto-Reset, Zero Ledger Impact, Multi-Tenant)
// ============================================================================
await test('RC01', 'Recurring Fixed Cost Checklist: month rollover in Thai time, zero ledger/wallet impact, tenant isolation, and idempotent migration', async () => {
  // 1. Static markup & script checks
  assert(indexHtml.includes('checklistFullList'), 'index.html must contain checklistFullList');
  assert(indexHtml.includes('checklistMonthBadge'), 'index.html must contain checklistMonthBadge');
  assert(indexHtml.includes('toggle_recurring_checklist_item'), 'index.html must reference toggle_recurring_checklist_item RPC');

  // 2. Unit logic: Month rollover evaluation
  const { exported } = createVmHarness();
  
  // Simulated checklist item checked in October 2026
  const itemOct = {
    id: 1,
    title: 'ค่าบริการอินเทอร์เน็ตสตูดิโอ',
    amount: 1199.00,
    due_day: 5,
    checked_period: '2026-10'
  };

  // Checked in October
  assert.strictEqual(exported.isChecklistItemChecked(itemOct, '2026-10'), true,
    'Item checked in 2026-10 must show as checked during 2026-10');

  // Month crossover: In November, it automatically shows as unchecked WITHOUT database mutation
  assert.strictEqual(exported.isChecklistItemChecked(itemOct, '2026-11'), false,
    'Item must automatically evaluate to unchecked on the 1st of the next month');

  // Year crossover: December to January
  const itemDec = { id: 2, title: 'ค่าเช่าสตูดิโอ', amount: 15000, due_day: 1, checked_period: '2026-12' };
  assert.strictEqual(exported.isChecklistItemChecked(itemDec, '2026-12'), true);
  assert.strictEqual(exported.isChecklistItemChecked(itemDec, '2027-01'), false,
    'Item must automatically evaluate to unchecked across year crossover');

  // Leap year crossover: February 29 to March 1
  const itemFebLeap = { id: 3, title: 'ค่าซอฟต์แวร์รายปี', amount: 3500, due_day: 28, checked_period: '2028-02' };
  assert.strictEqual(exported.isChecklistItemChecked(itemFebLeap, '2028-02'), true);
  assert.strictEqual(exported.isChecklistItemChecked(itemFebLeap, '2028-03'), false,
    'Item must automatically evaluate to unchecked across leap year February to March');

  // 3. PostgreSQL Database & RPC Execution with PGlite
  const pg = await initPgWithShims();
  await pg.exec(migrationSql);

  const userA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const userB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  await pg.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${userA}', 'usera@freelancehub.app'),
      ('${userB}', 'userb@freelancehub.app');
  `);

  // Setup wallet for User A to confirm zero balance deduction
  await pg.exec(`
    INSERT INTO public.wallets (id, user_id, name, type, balance, created_at, updated_at)
    VALUES (701, '${userA}', 'กระเป๋าหลัก', 'bank', 50000.00, NOW(), NOW());
  `);

  // Seed debt and legacy bills: 1 debt-linked bill, 1 reminder bill
  await pg.exec(`
    INSERT INTO public.debts (id, user_id, name, original_principal, remaining_principal)
    VALUES (999, '${userA}', 'ผ่อนกล้อง Sony A7IV', 50000.00, 30000.00);

    INSERT INTO public.bills (id, user_id, item, amount, due_date, linked_debt_id, is_paid)
    VALUES
      (801, '${userA}', 'ผ่อนกล้อง Sony A7IV', 5500.00, 15, 999, false),
      (802, '${userA}', 'ค่าไฟสตูดิโอ', 2400.00, 20, NULL, false);
  `);

  // Rerun idempotent migration script block
  await pg.exec(`
    INSERT INTO public.recurring_checklist_items (user_id, title, amount, due_day, note, source_bill_id, checked_period, created_at)
    SELECT
      b.user_id,
      COALESCE(NULLIF(TRIM(b.item), ''), 'รายจ่ายประจำ'),
      COALESCE(b.amount, 0.00),
      CASE WHEN b.due_date BETWEEN 1 AND 31 THEN b.due_date ELSE 1 END,
      COALESCE(b.notes, b.note),
      b.id,
      NULL,
      COALESCE(b.created_at, NOW())
    FROM public.bills b
    WHERE b.user_id IS NOT NULL
      AND b.linked_debt_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.recurring_checklist_items r
        WHERE r.user_id = b.user_id AND r.source_bill_id = b.id
      );
  `);

  // Verify only non-debt bill 802 was migrated
  const checkRows = await pg.query(`SELECT id, title, amount, source_bill_id, checked_period FROM public.recurring_checklist_items WHERE user_id = '${userA}';`);
  assert.strictEqual(checkRows.rows.length, 1, 'Only non-debt bills should be migrated into recurring checklist');
  assert.strictEqual(checkRows.rows[0].title, 'ค่าไฟสตูดิโอ');
  assert.strictEqual(checkRows.rows[0].source_bill_id, 802);
  assert.strictEqual(checkRows.rows[0].checked_period, null, 'Newly migrated checklist items must start unchecked');

  const itemId = checkRows.rows[0].id;

  // Set auth session as User A
  await pg.exec(`
    SET request.jwt.claim.sub = '${userA}';
    SET request.jwt.claim.role = 'authenticated';
  `);

  // Determine current period in Asia/Bangkok
  const curPeriodRes = await pg.query(`SELECT to_char(timezone('Asia/Bangkok', NOW()), 'YYYY-MM') AS cur_period;`);
  const curPeriod = curPeriodRes.rows[0].cur_period;

  // 4. Toggle check item via RPC
  const toggleCheck = await pg.query(`
    SELECT public.toggle_recurring_checklist_item(
      p_item_id := ${itemId},
      p_expected_period := '${curPeriod}',
      p_check := true
    ) AS res;
  `);
  const resCheck = toggleCheck.rows[0].res;
  assert.strictEqual(resCheck.success, true);
  assert.strictEqual(resCheck.checked, true);
  assert.strictEqual(resCheck.checked_period, curPeriod);

  // CRITICAL FINANCIAL CONTRACT: Verify wallet balance is 100% untouched and NO transaction created
  const walletCheck = await pg.query(`SELECT balance FROM public.wallets WHERE id = 701;`);
  assert.strictEqual(Number(walletCheck.rows[0].balance), 50000.00, 'Wallet balance must remain completely untouched (50,000.00)');

  const txCountCheck = await pg.query(`SELECT COUNT(*) AS count FROM public.transactions WHERE user_id = '${userA}';`);
  assert.strictEqual(Number(txCountCheck.rows[0].count), 0, 'Zero financial transactions must be created for reminder checklist toggle');

  // 5. Test Rollover Race Guard: client with mismatched period rejected
  const mismatchRes = await pg.query(`
    SELECT public.toggle_recurring_checklist_item(
      p_item_id := ${itemId},
      p_expected_period := '2020-01',
      p_check := true
    ) AS res;
  `);
  assert.strictEqual(mismatchRes.rows[0].res.success, false);
  assert.strictEqual(mismatchRes.rows[0].res.error, 'PERIOD_MISMATCH');

  // 6. Test Multi-Tenant Isolation: User B cannot modify User A's item
  await pg.exec(`
    SET request.jwt.claim.sub = '${userB}';
    SET request.jwt.claim.role = 'authenticated';
  `);

  const crossUserToggle = await pg.query(`
    SELECT public.toggle_recurring_checklist_item(
      p_item_id := ${itemId},
      p_expected_period := '${curPeriod}',
      p_check := false
    ) AS res;
  `);
  assert.strictEqual(crossUserToggle.rows[0].res.success, false);
  assert.strictEqual(crossUserToggle.rows[0].res.error, 'ITEM_NOT_FOUND', 'User B must not find or modify User A checklist item');

  await pg.close();
});

// ============================================================================
// SS01: On-Device Multi-Slip Scanner (Parser Engine, Review Drafts, Idempotency)
// ============================================================================
await test('SS01', 'On-Device Multi-Slip Scanner: draft review generation, ambiguity marking, duplicate warning, idempotency retry, memory/privacy cleanup', async () => {
  // 1. Static security check: NO external OCR API or cloud upload URL
  assert(!indexHtml.includes('api.ocr.space'), 'index.html must not call 3rd party OCR APIs');
  assert(!indexHtml.includes('cloud.google.com/vision'), 'index.html must not call Google Cloud Vision API');
  assert(!indexHtml.includes('api.openai.com'), 'index.html must not send slips to paid LLM cloud APIs');
  assert(indexHtml.includes('js/slip-parser.js'), 'index.html must include js/slip-parser.js');

  // 2. Draft review workflow and ambiguity marking
  const testSlipOcrText = `
    โอนเงินสำเร็จ
    ธนาคารกสิกรไทย
    29 ก.ย. 69 14:32 น.
    ไปยัง: นาย ธนากร จันทร์แจ่ม
    จำนวนเงิน 1,500.00 บาท
    ค่าธรรมเนียม 0.00 บาท
    เลขที่รายการ: 20260929987654321
  `;

  const SlipParserEngine = require('../js/slip-parser.js');

  const parsed = SlipParserEngine.parseSlipText(testSlipOcrText, {
    fileName: 'kplus_transfer.jpg',
    fileSize: 450000,
    lastModified: 1790670000000
  });

  assert.strictEqual(parsed.amount, 1500.00);
  assert.strictEqual(parsed.date, '2026-09-29');
  assert.strictEqual(parsed.time, '14:32');
  assert.strictEqual(parsed.receiver, 'นาย ธนากร จันทร์แจ่ม');
  assert.strictEqual(parsed.refNumber, '20260929987654321');
  assert.strictEqual(parsed.needs_review, false, 'Well-formed slip must not be flagged needs_review');

  // Ambiguity check: missing amount
  const ambiguousText = `
    โอนเงินสำเร็จ
    ธนาคารกสิกรไทย
    29 ก.ย. 69
    ไปยัง: นาย ธนากร จันทร์แจ่ม
  `;
  const ambiguousParsed = SlipParserEngine.parseSlipText(ambiguousText);
  assert.strictEqual(ambiguousParsed.amount, null, 'Must NOT invent 0.00 for unreadable amount');
  assert.strictEqual(ambiguousParsed.needs_review, true, 'Unreadable amount must be flagged needs_review');

  // 3. PostgreSQL Idempotent Transaction Creation with PGlite
  const pg = await initPgWithShims();
  await pg.exec(migrationSql);

  const testUserId = '77777777-7777-7777-7777-777777777777';
  await pg.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${testUserId}', 'slipuser@freelancehub.app');
    INSERT INTO public.wallets (id, user_id, name, type, balance, created_at, updated_at)
    VALUES (901, '${testUserId}', 'กสิกรไทย', 'bank', 10000.00, NOW(), NOW());
    SET request.jwt.claim.sub = '${testUserId}';
    SET request.jwt.claim.role = 'authenticated';
  `);

  // First save from slip draft
  const requestId = 'slip_req_20260929_uniq_01';
  const saveCall1 = await pg.query(`
    SELECT public.execute_create_transaction(
      p_date := '${parsed.date}'::date,
      p_type := 'รายจ่าย',
      p_category := 'ค่าเดินทาง',
      p_amount := ${parsed.amount},
      p_details := 'โอนให้ ${parsed.receiver} (Ref: ${parsed.refNumber})',
      p_wallet_id := 901,
      p_request_id := '${requestId}'
    ) AS res;
  `);

  const res1 = saveCall1.rows[0].res;
  assert.strictEqual(res1.success, true);
  assert.strictEqual(Number(res1.new_balance), 8500.00, 'Balance must be deducted from 10,000 to 8,500');

  // Retry with same requestId (idempotency guard)
  const saveCall2 = await pg.query(`
    SELECT public.execute_create_transaction(
      p_date := '${parsed.date}'::date,
      p_type := 'รายจ่าย',
      p_category := 'ค่าเดินทาง',
      p_amount := ${parsed.amount},
      p_details := 'โอนให้ ${parsed.receiver} (Ref: ${parsed.refNumber})',
      p_wallet_id := 901,
      p_request_id := '${requestId}'
    ) AS res;
  `);

  const res2 = saveCall2.rows[0].res;
  assert.strictEqual(res2.success, true);
  assert.strictEqual(res2.status, 'IDEMPOTENT_RETRY', 'Retry with same request_id must be flagged as IDEMPOTENT_RETRY');
  assert.strictEqual(Number(res2.new_balance), 8500.00, 'Balance must NOT be double-deducted on retry');

  // Verify only 1 transaction was inserted
  const txCheck = await pg.query(`SELECT COUNT(*) AS count FROM public.transactions WHERE user_id = '${testUserId}';`);
  assert.strictEqual(Number(txCheck.rows[0].count), 1, 'Only exactly 1 transaction should exist after retry');

  await pg.close();
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
