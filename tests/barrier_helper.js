/**
 * Barrier Synchronization Helper for Multi-Connection Concurrency Testing
 * 
 * Provides deterministic lock barrier evaluation with graph-based blocking chain
 * traversal, cycle protection, and rigorous predicate validation.
 * 
 * Directly resolves Codex Review finding H02.
 */

/**
 * Traverse blocking chain from startPid to targetPid with cycle protection.
 * Returns true if targetPid is reachable along the blocking graph edges.
 */
function chainReachesController(startPid, targetPid, pidToBlockersMap) {
  if (typeof startPid !== 'number' || typeof targetPid !== 'number') return false;
  if (startPid === targetPid) return false;

  const visited = new Set();
  const queue = [startPid];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) {
      continue; // cycle protection
    }
    visited.add(current);

    const blockers = pidToBlockersMap.get(current) || [];
    for (const blocker of blockers) {
      if (blocker === targetPid) {
        return true;
      }
      if (!visited.has(blocker)) {
        queue.push(blocker);
      }
    }
  }
  return false;
}

/**
 * Evaluates whether all worker PIDs are currently blocked by the controller PID.
 * 
 * Rules:
 * 1. workerPids must be non-empty and controllerPid must be a valid number.
 * 2. Every workerPid must have a corresponding row in activityRows.
 * 3. Every worker must be in a lock waiting state (wait_event_type = 'Lock' or wait_event in ('advisory', 'tuple', 'transactionid')).
 * 4. Every worker must have a non-empty blocking_pids array.
 * 5. Every worker's blocking chain must reach controllerPid (direct or indirect).
 */
function evaluateBarrierPredicate(workerPids, controllerPid, activityRows) {
  if (!Array.isArray(workerPids) || workerPids.length === 0) {
    return { ok: false, reason: 'workerPids must be a non-empty array' };
  }
  if (typeof controllerPid !== 'number' || isNaN(controllerPid)) {
    return { ok: false, reason: 'controllerPid must be a valid number' };
  }
  if (!Array.isArray(activityRows)) {
    return { ok: false, reason: 'activityRows must be an array' };
  }

  // Build lookup maps
  const rowMap = new Map();
  const pidToBlockersMap = new Map();

  for (const row of activityRows) {
    if (row && typeof row.pid === 'number') {
      rowMap.set(row.pid, row);
      const blockers = Array.isArray(row.blocking_pids) 
        ? row.blocking_pids.filter(p => typeof p === 'number') 
        : [];
      pidToBlockersMap.set(row.pid, blockers);
    }
  }

  // Verify each worker
  for (const workerPid of workerPids) {
    const row = rowMap.get(workerPid);
    if (!row) {
      return { ok: false, reason: `Worker PID ${workerPid} missing from activity rows` };
    }

    const isLockWait = (row.wait_event_type === 'Lock') || 
                       (row.wait_event === 'advisory' || row.wait_event === 'tuple' || row.wait_event === 'transactionid');
    if (!isLockWait) {
      return { ok: false, reason: `Worker PID ${workerPid} is not in a lock wait state (wait_event_type: ${row.wait_event_type}, wait_event: ${row.wait_event})` };
    }

    const blockers = pidToBlockersMap.get(workerPid) || [];
    if (blockers.length === 0) {
      return { ok: false, reason: `Worker PID ${workerPid} has empty blocking_pids` };
    }

    const reaches = chainReachesController(workerPid, controllerPid, pidToBlockersMap);
    if (!reaches) {
      return { ok: false, reason: `Worker PID ${workerPid} blocking chain [${blockers.join(', ')}] does not lead to controller PID ${controllerPid}` };
    }
  }

  return { ok: true, reason: 'All workers verified in lock wait state blocked by controller' };
}

/**
 * Polls monitorClient for pg_stat_activity until evaluateBarrierPredicate returns ok: true,
 * or throws if timeoutMs is exceeded.
 */
async function waitForWorkersBlocked(monitorClient, workerPids, controllerPid, timeoutMs = 6000) {
  const startTime = Date.now();
  let lastEvaluation = null;

  while (Date.now() - startTime < timeoutMs) {
    const res = await monitorClient.query(`
      SELECT 
        pid,
        wait_event_type,
        wait_event,
        state,
        pg_blocking_pids(pid) AS blocking_pids,
        query
      FROM pg_stat_activity;
    `);

    lastEvaluation = evaluateBarrierPredicate(workerPids, controllerPid, res.rows);
    if (lastEvaluation.ok) {
      return {
        success: true,
        elapsedMs: Date.now() - startTime,
        workers: workerPids
      };
    }

    await new Promise(r => setTimeout(r, 25));
  }

  // Timeout reached: fetch diagnostic snapshot
  const diag = await monitorClient.query(`
    SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blocking_pids, query
    FROM pg_stat_activity
    WHERE pid = ANY($1::int[]) OR pid = $2;
  `, [workerPids, controllerPid]);

  throw new Error(
    `[H02] Barrier Timeout: Workers failed to enter verified controller lock wait state within ${timeoutMs}ms.\n` +
    `Expected Workers: [${workerPids.join(', ')}], Controller PID: ${controllerPid}\n` +
    `Last predicate failure: ${lastEvaluation ? lastEvaluation.reason : 'unknown'}\n` +
    `Diagnostic snapshot:\n${JSON.stringify(diag.rows, null, 2)}`
  );
}

module.exports = {
  chainReachesController,
  evaluateBarrierPredicate,
  waitForWorkersBlocked
};
