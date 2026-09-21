/**
 * Automated Acceptance Test Suite for Natthawit Studio / FreelanceHub
 * Verifies all 12 items from the Codex Code Review
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Starting FreelanceHub Financial & Architecture Verification Suite...\n');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}\n`);
  }
}

const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const migrationSql = fs.readFileSync(path.join(__dirname, '../supabase_migration_v2.sql'), 'utf8');

// -------------------------------------------------------------
// Test 1: server.js Path Traversal Protection
// -------------------------------------------------------------
test('Test 1: server.js sanitizes and blocks path traversal attempts', () => {
  assert(serverCode.includes('filePath.startsWith(PUBLIC_DIR)'), 'server.js must verify filePath starts with PUBLIC_DIR');
  assert(serverCode.includes('403 Forbidden'), 'server.js must return 403 Forbidden on traversal');
  
  // Test traversal simulation matching server.js
  const PUBLIC_DIR = path.resolve(__dirname, '..');
  function simulatePathCheck(reqPath) {
    let decodedPath = decodeURIComponent(reqPath);
    let normalized = decodedPath.replace(/\\/g, '/');
    if (normalized === '/' || normalized === '' || normalized === '/.') {
      normalized = '/index.html';
    }
    const filePath = path.resolve(PUBLIC_DIR, '.' + normalized);
    return filePath.startsWith(PUBLIC_DIR);
  }

  assert.strictEqual(simulatePathCheck('/index.html'), true, 'Normal index.html should be allowed');
  assert.strictEqual(simulatePathCheck('/../../../../etc/passwd'), false, 'Malicious path traversal must be blocked');
  assert.strictEqual(simulatePathCheck('/..\\..\\..\\..\\etc\\passwd'), false, 'Backslash traversal must be blocked');
});

// -------------------------------------------------------------
// Test 2: server.js Host Binding (127.0.0.1)
// -------------------------------------------------------------
test('Test 2: server.js binds to 127.0.0.1 by default instead of 0.0.0.0', () => {
  assert(serverCode.includes("HOST = process.env.HOST || '127.0.0.1'"), 'server.js must bind to 127.0.0.1 by default');
  assert(!serverCode.includes("'0.0.0.0'"), 'server.js must not hardcode 0.0.0.0');
});

// -------------------------------------------------------------
// Test 3: Hero Balance Card reflects authoritative wallet balances
// -------------------------------------------------------------
test('Test 3: Hero Balance Card calculates authoritative total from wallets', () => {
  assert(indexHtml.includes('totalWalletBal = (appData.wallets && appData.wallets.length > 0)'),
    'Hero balance must calculate totalWalletBal from appData.wallets');
  assert(indexHtml.includes('appData.wallets.reduce(function(sum, w) { return sum + (parseFloat(w.balance) || 0); }'),
    'Hero balance must sum all active wallet balances');
  assert(indexHtml.includes('Math.abs(totalWalletBal).toLocaleString'),
    'Hero balance element must display totalWalletBal');
});

// -------------------------------------------------------------
// Test 4: Financial Isolation: Transfers & Recon excluded from Revenue/Expense
// -------------------------------------------------------------
test('Test 4: Transfers and Reconciliation adjustments are excluded from business KPIs', () => {
  assert(indexHtml.includes("var isTransfer = (t.category === 'โอนเงิน' || t.type === 'โอนเงิน')"),
    'Must identify internal transfers');
  assert(indexHtml.includes("var isRecon = (t.category === 'ปรับยอดเงิน' || t.type === 'ปรับยอดเงิน')"),
    'Must identify reconciliation adjustments');
  assert(indexHtml.includes('if (matchPeriod && !isTransfer && !isRecon)'),
    'periodInc and periodExp must exclude transfers and adjustments');
});

// -------------------------------------------------------------
// Test 5: Standardized Unpaid Receivables Formula
// -------------------------------------------------------------
test('Test 5: Standardized unpaid receivables formula: Math.max(0, budget - received)', () => {
  assert(indexHtml.includes('var unpaid = Math.max(0, budget - received);'),
    'Unpaid receivables formula must be Math.max(0, budget - received)');
  assert(!indexHtml.includes('if (b > 0 && !j.is_complete) {\n          totalUnpaidFromJobs += b;'),
    'Must not use naive is_complete check that ignores partial payments');
});

// -------------------------------------------------------------
// Test 6: Calendar Month Navigation (Jan 31 to Feb safety)
// -------------------------------------------------------------
test('Test 6: Calendar month navigation clamps day to avoid month skip on 31st', () => {
  assert(indexHtml.includes('targetDate.setDate(1);'), 'Must set date to 1st before stepping month');
  assert(indexHtml.includes('Math.min(curDay, daysInTargetMonth)'), 'Must clamp day to daysInTargetMonth');

  // Logic simulation
  function testMonthStep(startDate, step) {
    const targetDate = new Date(startDate.getTime());
    const curDay = targetDate.getDate();
    targetDate.setDate(1);
    targetDate.setMonth(targetDate.getMonth() + step);
    const daysInTargetMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
    targetDate.setDate(Math.min(curDay, daysInTargetMonth));
    return targetDate;
  }

  // 2026-01-31 + 1 month should be 2026-02-28
  const jan31 = new Date(2026, 0, 31);
  const febResult = testMonthStep(jan31, 1);
  assert.strictEqual(febResult.getMonth(), 1, 'Target month must be February (month index 1)');
  assert.strictEqual(febResult.getDate(), 28, 'Target day in non-leap year must be 28');
});

// -------------------------------------------------------------
// Test 7: Button Wireups & Aliases
// -------------------------------------------------------------
test('Test 7: Button click handlers and aliases are wired correctly', () => {
  assert(indexHtml.includes('function openNewBillDrawer()'), 'openNewBillDrawer alias must be defined');
  assert(indexHtml.includes('function openPdfDrawer()'), 'openPdfDrawer alias must be defined');
  assert(indexHtml.includes("else if (currentTab === 'projects') openAddJobModal();"),
    'openContextAction must handle projects tab by opening add job modal');
  assert(!indexHtml.includes('onclick="openNewBillDrawer()"'), 'Quick action button must call openAddBillModal');
  assert(!indexHtml.includes('onclick="openPdfDrawer()"'), 'Quick action button must call openPDFModal');
});

// -------------------------------------------------------------
// Test 8: Real PDF Generation (HTML print preview document)
// -------------------------------------------------------------
test('Test 8: handleGeneratePDF generates clean printable invoice/quotation document', () => {
  assert(indexHtml.includes("window.open('', '_blank', 'width=840,height=960')"),
    'Must open print document window');
  assert(indexHtml.includes('window.print()'), 'Must include print trigger');
  assert(indexHtml.includes('NATTHAWIT STUDIO'), 'Must include studio logo and branding');
  assert(indexHtml.includes('table-main'), 'Must include itemized table');
});

// -------------------------------------------------------------
// Test 9: Full 6-Sheet Excel Export
// -------------------------------------------------------------
test('Test 9: generateAndDownloadExcel exports 6 sheets (Transactions, Jobs, Wallets, Debts, Cards, Bills)', () => {
  assert(indexHtml.includes("'Transactions'"), 'Excel must include Transactions sheet');
  assert(indexHtml.includes("'Jobs'"), 'Excel must include Jobs sheet');
  assert(indexHtml.includes("'Wallets'"), 'Excel must include Wallets sheet');
  assert(indexHtml.includes("'Debts'"), 'Excel must include Debts sheet');
  assert(indexHtml.includes("'Cards'"), 'Excel must include Cards sheet');
  assert(indexHtml.includes("'Bills'"), 'Excel must include Bills sheet');
});

// -------------------------------------------------------------
// Test 10: Clean Empty States (No Dummy Data Injection)
// -------------------------------------------------------------
test('Test 10: defaultDebts and defaultCards are empty and do not inject dummy items', () => {
  assert(indexHtml.includes('var defaultDebts = [];'), 'defaultDebts must be empty array');
  assert(indexHtml.includes('var defaultCards = [];'), 'defaultCards must be empty array');
  assert(!indexHtml.includes("name: 'Shopee SPayLater (เลนส์ 24-70mm)'"), 'Must not have hardcoded mock debts in defaultDebts');
  assert(!indexHtml.includes("name: 'KBank OneSiam'"), 'Must not have hardcoded mock cards in defaultCards');
});

// -------------------------------------------------------------
// Test 11: supabase_migration_v2.sql Completeness
// -------------------------------------------------------------
test('Test 11: supabase_migration_v2.sql contains all tables, RLS policies, and atomic RPCs', () => {
  assert(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.wallets'), 'Must create wallets table');
  assert(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.debts'), 'Must create debts table');
  assert(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.debt_payments'), 'Must create debt_payments table');
  assert(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.cards'), 'Must create cards table');
  assert(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.transfers'), 'Must create transfers table');
  assert(migrationSql.includes('ALTER TABLE public.transactions'), 'Must alter transactions with relational FKs');
  assert(migrationSql.includes('CREATE OR REPLACE FUNCTION public.adjust_wallet_balance'), 'Must include adjust_wallet_balance RPC');
  assert(migrationSql.includes('CREATE OR REPLACE FUNCTION public.execute_wallet_transfer'), 'Must include execute_wallet_transfer RPC');
  assert(migrationSql.includes('ENABLE ROW LEVEL SECURITY'), 'Must enable RLS');
});

// -------------------------------------------------------------
// Test 12: Backend Wallet Balance Persistence
// -------------------------------------------------------------
test('Test 12: syncWalletBalanceToBackend synchronizes wallet balance changes to Supabase', () => {
  assert(indexHtml.includes('async function syncWalletBalanceToBackend(walletId, newBalance)'),
    'syncWalletBalanceToBackend must be defined');
  assert(indexHtml.includes("db.from('wallets').update({ balance: newBalance"),
    'Must update wallets.balance in Supabase');
  assert(indexHtml.includes('await syncWalletBalanceToBackend(target.id, target.balance)'),
    'Transaction CRUD must sync wallet balance to backend');
  assert(indexHtml.includes('await syncWalletBalanceToBackend(fromId, fromWallet.balance)'),
    'Transfer must sync source wallet balance to backend');
  assert(indexHtml.includes('await syncWalletBalanceToBackend(toId, toWallet.balance)'),
    'Transfer must sync target wallet balance to backend');
});

console.log(`\n📊 Verification Summary: ${passedTests}/${totalTests} Tests Passed (${Math.round((passedTests / totalTests) * 100)}%)\n`);

if (passedTests === totalTests) {
  console.log('🎉 ALL 12 VERIFICATION TESTS PASSED PERFECTLY!\n');
  process.exit(0);
} else {
  console.error('💥 Some tests failed. Please review the errors above.\n');
  process.exit(1);
}
