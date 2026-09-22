/**
 * Unit Regression Test Suite for H02 Barrier Synchronization Predicate
 * 
 * Directly verifies graph-based blocking chain resolution across all topology cases:
 *   1. Direct chain (Worker A -> Controller, Worker B -> Controller) -> PASS
 *   2. Indirect chain (Worker B -> Worker A -> Controller) -> PASS
 *   3. Unrelated blocker (Worker A -> PID 999) -> FAIL
 *   4. Empty blocker (Worker with wait_event_type=Lock but blocking_pids=[]) -> FAIL
 *   5. Missing worker (Worker PID missing from activity rows) -> FAIL
 *   6. Graph cycle (Worker A -> Worker B -> Worker A) -> FAIL (Cycle protected)
 *   7. Advisory lock wait event for NULL-wallet race -> PASS
 *   8. Non-lock state (Worker active without wait_event_type=Lock) -> FAIL
 *   9. Timeout behavior in waitForWorkersBlocked with diagnostic snapshot -> FAIL
 */

const assert = require('assert');
const { 
  chainReachesController, 
  evaluateBarrierPredicate, 
  waitForWorkersBlocked 
} = require('./barrier_helper');

console.log('================================================================================');
console.log('🧪 Unit Regression Suite: H02 Barrier Predicate & Graph Resolution');
console.log('================================================================================\n');

const CONTROLLER_PID = 100;
const WORKER_1 = 101;
const WORKER_2 = 102;
const UNRELATED_PID = 999;

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// ------------------------------------------------------------------------------
// Test 1: Direct Chain
// ------------------------------------------------------------------------------
runTest('Direct Chain: Both workers directly blocked by controller', () => {
  const rows = [
    { pid: CONTROLLER_PID, wait_event_type: null, wait_event: null, blocking_pids: [] },
    { pid: WORKER_1, wait_event_type: 'Lock', wait_event: 'tuple', blocking_pids: [CONTROLLER_PID] },
    { pid: WORKER_2, wait_event_type: 'Lock', wait_event: 'tuple', blocking_pids: [CONTROLLER_PID] }
  ];
  const evalRes = evaluateBarrierPredicate([WORKER_1, WORKER_2], CONTROLLER_PID, rows);
  assert.strictEqual(evalRes.ok, true, 'Direct chain must be accepted');
});

// ------------------------------------------------------------------------------
// Test 2: Indirect Chain
// ------------------------------------------------------------------------------
runTest('Indirect Chain: Worker B blocked by Worker A, who is blocked by controller', () => {
  const rows = [
    { pid: CONTROLLER_PID, wait_event_type: null, wait_event: null, blocking_pids: [] },
    { pid: WORKER_1, wait_event_type: 'Lock', wait_event: 'tuple', blocking_pids: [CONTROLLER_PID] },
    { pid: WORKER_2, wait_event_type: 'Lock', wait_event: 'tuple', blocking_pids: [WORKER_1] }
  ];
  const evalRes = evaluateBarrierPredicate([WORKER_1, WORKER_2], CONTROLLER_PID, rows);
  assert.strictEqual(evalRes.ok, true, 'Indirect chain Worker B -> Worker A -> Controller must be accepted');
});

// ------------------------------------------------------------------------------
// Test 3: Unrelated Blocker
// ------------------------------------------------------------------------------
runTest('Unrelated Blocker: Worker blocked by non-controller PID 999', () => {
  const rows = [
    { pid: CONTROLLER_PID, wait_event_type: null, wait_event: null, blocking_pids: [] },
    { pid: WORKER_1, wait_event_type: 'Lock', wait_event: 'tuple', blocking_pids: [CONTROLLER_PID] },
    { pid: WORKER_2, wait_event_type: 'Lock', wait_event: 'tuple', blocking_pids: [UNRELATED_PID] },
    { pid: UNRELATED_PID, wait_event_type: 'Lock', wait_event: 'tuple', blocking_pids: [888] }
  ];
  const evalRes = evaluateBarrierPredicate([WORKER_1, WORKER_2], CONTROLLER_PID, rows);
  assert.strictEqual(evalRes.ok, false, 'Unrelated blocker must be rejected');
  assert(evalRes.reason.includes('does not lead to controller PID 100'));
});

// ------------------------------------------------------------------------------
// Test 4: Empty Blocker
// ------------------------------------------------------------------------------
runTest('Empty Blocker: Worker has wait_event_type=Lock but blocking_pids is empty', () => {
  const rows = [
    { pid: CONTROLLER_PID, wait_event_type: null, wait_event: null, blocking_pids: [] },
    { pid: WORKER_1, wait_event_type: 'Lock', wait_event: 'tuple', blocking_pids: [CONTROLLER_PID] },
    { pid: WORKER_2, wait_event_type: 'Lock', wait_event: 'tuple', blocking_pids: [] }
  ];
  const evalRes = evaluateBarrierPredicate([WORKER_1, WORKER_2], CONTROLLER_PID, rows);
  assert.strictEqual(evalRes.ok, false, 'Empty blocking_pids must be rejected');
  assert(evalRes.reason.includes('has empty blocking_pids'));
});

// ------------------------------------------------------------------------------
// Test 5: Missing Worker
// ------------------------------------------------------------------------------
runTest('Missing Worker: Worker 2 PID missing from activity rows entirely', () => {
  const rows = [
    { pid: CONTROLLER_PID, wait_event_type: null, wait_event: null, blocking_pids: [] },
    { pid: WORKER_1, wait_event_type: 'Lock', wait_event: 'tuple', blocking_pids: [CONTROLLER_PID] }
  ];
  const evalRes = evaluateBarrierPredicate([WORKER_1, WORKER_2], CONTROLLER_PID, rows);
  assert.strictEqual(evalRes.ok, false, 'Missing worker must be rejected');
  assert(evalRes.reason.includes('missing from activity rows'));
});

// ------------------------------------------------------------------------------
// Test 6: Graph Cycle Protection
// ------------------------------------------------------------------------------
runTest('Cycle Protection: Worker 1 and Worker 2 block each other in a loop', () => {
  const rows = [
    { pid: CONTROLLER_PID, wait_event_type: null, wait_event: null, blocking_pids: [] },
    { pid: WORKER_1, wait_event_type: 'Lock', wait_event: 'tuple', blocking_pids: [WORKER_2] },
    { pid: WORKER_2, wait_event_type: 'Lock', wait_event: 'tuple', blocking_pids: [WORKER_1] }
  ];
  const evalRes = evaluateBarrierPredicate([WORKER_1, WORKER_2], CONTROLLER_PID, rows);
  assert.strictEqual(evalRes.ok, false, 'Cycle without controller must be rejected without hanging');
  assert(evalRes.reason.includes('does not lead to controller'));
});

// ------------------------------------------------------------------------------
// Test 7: Advisory Lock Wait Event
// ------------------------------------------------------------------------------
runTest('Advisory Wait Event: Worker waiting on advisory lock held by controller', () => {
  const rows = [
    { pid: CONTROLLER_PID, wait_event_type: null, wait_event: null, blocking_pids: [] },
    { pid: WORKER_1, wait_event_type: 'Lock', wait_event: 'advisory', blocking_pids: [CONTROLLER_PID] },
    { pid: WORKER_2, wait_event_type: 'Lock', wait_event: 'advisory', blocking_pids: [CONTROLLER_PID] }
  ];
  const evalRes = evaluateBarrierPredicate([WORKER_1, WORKER_2], CONTROLLER_PID, rows);
  assert.strictEqual(evalRes.ok, true, 'Advisory lock wait event must be accepted');
});

// ------------------------------------------------------------------------------
// Test 8: Non-Lock State
// ------------------------------------------------------------------------------
runTest('Non-Lock State: Worker running normal CPU query (not waiting on lock)', () => {
  const rows = [
    { pid: CONTROLLER_PID, wait_event_type: null, wait_event: null, blocking_pids: [] },
    { pid: WORKER_1, wait_event_type: 'Lock', wait_event: 'tuple', blocking_pids: [CONTROLLER_PID] },
    { pid: WORKER_2, wait_event_type: null, wait_event: null, blocking_pids: [CONTROLLER_PID] }
  ];
  const evalRes = evaluateBarrierPredicate([WORKER_1, WORKER_2], CONTROLLER_PID, rows);
  assert.strictEqual(evalRes.ok, false, 'Worker not in lock wait state must be rejected');
  assert(evalRes.reason.includes('is not in a lock wait state'));
});

// ------------------------------------------------------------------------------
// Test 9: Async Timeout & Diagnostic Snapshot in waitForWorkersBlocked
// ------------------------------------------------------------------------------
(async () => {
  total++;
  try {
    const mockMonitorClient = {
      query: async () => ({
        rows: [
          { pid: WORKER_1, wait_event_type: 'Lock', wait_event: 'tuple', blocking_pids: [CONTROLLER_PID] },
          { pid: WORKER_2, wait_event_type: null, wait_event: null, blocking_pids: [] }
        ]
      })
    };

    let timedOut = false;
    try {
      await waitForWorkersBlocked(mockMonitorClient, [WORKER_1, WORKER_2], CONTROLLER_PID, 100);
    } catch (err) {
      timedOut = true;
      assert(err.message.includes('[H02] Barrier Timeout'), 'Must throw [H02] Barrier Timeout');
      assert(err.message.includes('Expected Workers: [101, 102]'), 'Must include expected workers in diagnostic');
      assert(err.message.includes('Diagnostic snapshot:'), 'Must include diagnostic snapshot');
    }
    assert(timedOut, 'Must time out when predicate is not satisfied within timeoutMs');
    console.log('  ✅ [PASS] Timeout & Diagnostics: Correctly times out and reports diagnostic snapshot');
    passed++;
  } catch (err) {
    console.error('  ❌ [FAIL] Timeout & Diagnostics');
    console.error(`     Error: ${err.message}`);
    process.exitCode = 1;
  }

  console.log('\n=======================================================');
  console.log(`🏁 H02 Unit Regression Results: ${passed} / ${total} tests PASSED`);
  console.log('=======================================================\n');

  if (passed < total) {
    process.exit(1);
  }
})();
