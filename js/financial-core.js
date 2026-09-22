/**
 * Financial Core Logic Module - Natthawit Studio / FreelanceHub
 * Pure domain rules, selectors, invariant checks, and immutable delta computations.
 * Compatible with both Browser (window.FinancialCore) and Node.js (module.exports).
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FinancialCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  var exports = {};

  // ==========================================================================
  // 1. DOMAIN TRANSACTION CLASSIFIERS & SELECTORS
  // ==========================================================================

  /**
   * Internal Transfer Classifier:
   * Transfer principal legs are non-operating balance shifts between accounts.
   * Transfer fees are separate operating expenses.
   */
  exports.isTransferTx = function(t) {
    if (!t) return false;
    if (t.category === 'โอนเงิน' || t.type === 'โอนเงิน') return true;
    if (t.transfer_id && t.category !== 'ค่าธรรมเนียม' && t.type !== 'รายจ่าย') return true;
    return false;
  };

  /**
   * Reconciliation Adjustment Classifier:
   * Non-operating balance corrections to align system with bank statements.
   */
  exports.isReconTx = function(t) {
    if (!t) return false;
    return t.category === 'ปรับยอดเงิน' || t.type === 'ปรับยอดเงิน';
  };

  /**
   * Debt Principal Repayment Classifier:
   * Financing cash outflow (balance sheet liability reduction), not business operating expense.
   */
  exports.isDebtPrincipalTx = function(t) {
    if (!t) return false;
    return t.category === 'ชำระหนี้/ผ่อนสินค้า' || t.type === 'ชำระหนี้/ผ่อนสินค้า';
  };

  /**
   * Operating Revenue / Income:
   * Real business earnings. Excludes opening balance, transfers, and reconciliation adjustments.
   */
  exports.isOperatingIncome = function(t) {
    if (!t) return false;
    if (exports.isTransferTx(t)) return false;
    if (exports.isReconTx(t)) return false;
    if (t.category === 'ยกยอดมา') return false;
    return t.type === 'รายรับ';
  };

  /**
   * Operating Expense:
   * Real studio operating expenses (rent, gear, food, fees, debt interest).
   * Excludes transfers, reconciliations, and debt principal repayments.
   * Transfer fee transactions (type: 'รายจ่าย', category: 'ค่าธรรมเนียม') ARE counted.
   */
  exports.isOperatingExpense = function(t) {
    if (!t) return false;
    if (exports.isTransferTx(t)) return false;
    if (exports.isReconTx(t)) return false;
    if (exports.isDebtPrincipalTx(t)) return false;
    return t.type === 'รายจ่าย';
  };

  // ==========================================================================
  // 2. IMMUTABLE EDIT DELTA COMPUTATION & CANONICAL WALLET RESOLVER
  // ==========================================================================

  /**
   * Resolves the canonical wallet ID for a transaction record.
   * If tx.wallet_id is missing or null, attempts to resolve from tx.details
   * (parsing bracket format [scope | account] or JSON {"account":"..."}).
   * Matches strictly against available wallets.
   *
   * @param {Object} tx - Transaction or form payload
   * @param {Array} wallets - Available wallet records
   * @returns {number|null} Resolved wallet ID or null if unresolvable
   */
  exports.resolveWalletId = function(tx, wallets) {
    if (!tx) return null;
    wallets = wallets || [];

    // 1. Direct wallet_id
    if (tx.wallet_id !== undefined && tx.wallet_id !== null && tx.wallet_id !== '') {
      var wid = parseInt(tx.wallet_id, 10);
      if (!isNaN(wid)) {
        var found = wallets.find(function(w) { return w.id === wid; });
        if (found) return found.id;
        return wid;
      }
    }

    // 2. Parse from details string
    var details = tx.details;
    if (typeof details !== 'string' || !details.trim()) return null;
    details = details.trim();

    var accName = '';

    // Check JSON format: e.g. {"account":"บัญชี A", ...}
    if (details.charAt(0) === '{') {
      try {
        var parsed = JSON.parse(details);
        if (parsed && parsed.account) {
          accName = String(parsed.account).trim();
        }
      } catch (e) {
        // Not valid JSON, continue to bracket check
      }
    }

    // Check Bracket format: e.g. [สตูดิโอ | บัญชี A] ...
    if (!accName && details.charAt(0) === '[') {
      var closeBracket = details.indexOf(']');
      if (closeBracket > 1) {
        var tagContent = details.substring(1, closeBracket);
        var parts = tagContent.split('|');
        if (parts.length >= 2) {
          accName = parts[1].trim();
        } else if (parts.length === 1) {
          accName = parts[0].trim();
        }
      }
    }

    if (!accName) return null;

    // Strict exact name matching against wallets (never fuzzy/substring!)
    var matches = wallets.filter(function(w) {
      return w && w.name && w.name.trim() === accName;
    });

    if (matches.length === 1) {
      return matches[0].id;
    }

    return null;
  };

  /**
   * Computes the exact balance adjustments required when editing a transaction,
   * without mutating the original transaction, payload, or wallet objects.
   * Resolves canonical wallet identities for both legacy and ID-backed records.
   *
   * @param {Object} oldTx - Original transaction record before edit
   * @param {Object} newPayload - Form values being applied
   * @param {Array} wallets - Available wallet records
   * @returns {Object} Delta computation summary
   */
  exports.computeEditDelta = function(oldTx, newPayload, wallets) {
    if (!oldTx) throw new Error('Original transaction is required');
    newPayload = newPayload || {};
    wallets = wallets || [];

    var oldAmt = parseFloat(oldTx.amount) || 0;
    var newAmt = (newPayload.amount !== undefined) ? (parseFloat(newPayload.amount) || 0) : oldAmt;

    var oldType = oldTx.type || 'รายจ่าย';
    var newType = newPayload.type || oldType;

    // Canonical resolution of wallet identities (MR01)
    var oldWalletId = exports.resolveWalletId(oldTx, wallets);
    var newWalletId = exports.resolveWalletId(newPayload, wallets);
    if (newWalletId === null && (newPayload.wallet_id === undefined || newPayload.wallet_id === null || newPayload.wallet_id === '')) {
      newWalletId = oldWalletId;
    }

    var isSameWallet = (oldWalletId !== null && newWalletId !== null && oldWalletId === newWalletId);

    // Signed effect of old transaction: Income increases wallet (+), Expense decreases wallet (-)
    var oldSigned = (oldType === 'รายรับ') ? oldAmt : -oldAmt;
    // To revert the old transaction: reverse its signed effect
    var revertOld = -oldSigned;

    // Signed effect of new transaction:
    var newSigned = (newType === 'รายรับ') ? newAmt : -newAmt;

    if (isSameWallet) {
      var netDelta = Math.round((revertOld + newSigned) * 100) / 100;
      var hasFinancialChange = (netDelta !== 0);

      return {
        isSameWallet: true,
        targetWalletId: newWalletId,
        netDelta: netDelta,
        hasFinancialChange: hasFinancialChange,
        revertOldDelta: 0,
        applyNewDelta: 0
      };
    } else {
      // Wallet changed: old wallet is refunded, new wallet has new transaction applied
      return {
        isSameWallet: false,
        oldWalletId: oldWalletId,
        newWalletId: newWalletId,
        revertOldDelta: oldWalletId !== null ? Math.round(revertOld * 100) / 100 : 0,
        applyNewDelta: newWalletId !== null ? Math.round(newSigned * 100) / 100 : 0,
        netDelta: 0,
        hasFinancialChange: true
      };
    }
  };

  // ==========================================================================
  // 3. DEBT PAYMENT VALIDATION (ACCOUNTING INTEGRITY)
  // ==========================================================================

  /**
   * Validates debt payment split:
   * 1. Total must equal principal portion + interest portion (within 0.01)
   * 2. Principal portion cannot exceed remaining principal (within 0.01)
   * 3. Negative portions are rejected
   */
  exports.validateDebtPayment = function(total, principal, interest, remainingPrincipal) {
    total = parseFloat(total) || 0;
    principal = parseFloat(principal) || 0;
    interest = parseFloat(interest) || 0;
    remainingPrincipal = parseFloat(remainingPrincipal) || 0;

    if (total <= 0) {
      return { valid: false, error: 'ยอดชำระต้องมากกว่า 0 บาท' };
    }
    if (principal < 0 || interest < 0) {
      return { valid: false, error: 'ยอดเงินต้นและดอกเบี้ยต้องไม่ติดลบ' };
    }
    if (Math.abs(total - (principal + interest)) > 0.01) {
      return {
        valid: false,
        error: 'ยอดชำระรวม (฿' + total.toFixed(2) + ') ต้องเท่ากับ เงินต้น (฿' + principal.toFixed(2) + ') + ดอกเบี้ย (฿' + interest.toFixed(2) + ')'
      };
    }
    if (principal > remainingPrincipal + 0.01) {
      return {
        valid: false,
        error: 'ยอดชำระตัดเงินต้น (฿' + principal.toFixed(2) + ') ต้องไม่เกินเงินต้นคงเหลือ (฿' + remainingPrincipal.toFixed(2) + ')'
      };
    }

    return { valid: true };
  };

  // ==========================================================================
  // 4. RECONCILIATION & STALE STATE DETECTION
  // ==========================================================================

  /**
   * Determines reconciliation adjustment and detects stale client views.
   *
   * @param {number} currentSystemBal - Current balance in database/authoritative state
   * @param {number|null} expectedBal - The balance the client saw when opening the dialog (null to skip check)
   * @param {number} actualBal - Bank/account balance counted by user
   */
  exports.computeReconciliation = function(currentSystemBal, expectedBal, actualBal) {
    currentSystemBal = parseFloat(currentSystemBal) || 0;
    actualBal = parseFloat(actualBal) || 0;

    // Stale check: if client expected a balance that has since changed on server
    if (expectedBal !== null && expectedBal !== undefined) {
      expectedBal = parseFloat(expectedBal) || 0;
      if (Math.abs(currentSystemBal - expectedBal) > 0.01) {
        return {
          status: 'STALE',
          diff: 0,
          currentSystemBal: currentSystemBal,
          expectedBal: expectedBal,
          error: 'ยอดเงินในระบบมีการเปลี่ยนแปลงระหว่างการตรวจสอบ กรุณาตรวจสอบยอดใหม่อีกครั้ง'
        };
      }
    }

    var diff = Math.round((actualBal - currentSystemBal) * 100) / 100;
    if (Math.abs(diff) < 0.005) {
      return { status: 'NO_OP', diff: 0, newBalance: currentSystemBal };
    }

    return {
      status: 'ADJUST',
      diff: diff,
      newBalance: Math.round((currentSystemBal + diff) * 100) / 100
    };
  };

  // ==========================================================================
  // 5. UNPAID RECEIVABLES FORMULA
  // ==========================================================================

  /**
   * Standardized formula for unpaid receivables from client jobs.
   * Math.max(0, budget - receivedOperatingIncome)
   */
  exports.computeJobReceivable = function(job, jobIncomeTotal) {
    var budget = parseFloat(job && job.budget) || 0;
    var received = parseFloat(jobIncomeTotal) || 0;
    return Math.max(0, budget - received);
  };

  // ==========================================================================
  // 6. DASHBOARD & REPORTING AGGREGATE CALCULATOR
  // ==========================================================================

  /**
   * Computes standard KPIs across all views to guarantee 100% mathematical consistency.
   */
  exports.calculateFinancialSummary = function(transactions, periodFilterFn) {
    transactions = transactions || [];
    var income = 0;
    var expense = 0;
    var debtPrincipalOutflow = 0;
    var transferCount = 0;
    var reconCount = 0;

    transactions.forEach(function(t) {
      if (periodFilterFn && !periodFilterFn(t)) return;

      var amt = parseFloat(t.amount) || 0;

      if (exports.isOperatingIncome(t)) {
        income += amt;
      } else if (exports.isOperatingExpense(t)) {
        expense += amt;
      } else if (exports.isDebtPrincipalTx(t)) {
        debtPrincipalOutflow += amt;
      } else if (exports.isTransferTx(t)) {
        transferCount++;
      } else if (exports.isReconTx(t)) {
        reconCount++;
      }
    });

    income = Math.round(income * 100) / 100;
    expense = Math.round(expense * 100) / 100;
    var netOperating = Math.round((income - expense) * 100) / 100;
    var netCashflow = Math.round((income - expense - debtPrincipalOutflow) * 100) / 100;

    return {
      income: income,
      expense: expense,
      netOperating: netOperating,
      debtPrincipalOutflow: debtPrincipalOutflow,
      netCashflow: netCashflow,
      transferCount: transferCount,
      reconCount: reconCount
    };
  };

  return exports;
});
