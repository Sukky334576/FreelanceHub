# Reconciliation repair — 24 October 2026

Legacy production `transactions` lacked `updated_at`, although the installed
`execute_wallet_reconciliation` RPC inserts that column. Postgres logged `42703`
at 09:16 Bangkok time. `CREATE TABLE IF NOT EXISTS` had skipped the existing table;
the migration's ALTER section did not repair the missing column.

## Database repair

Applied `supabase/migrations/20261024021911_repair_transactions_updated_at.sql`
through the Supabase SQL Editor to the existing `natthawit-app` production project
on 24 October 2026. The connected MCP authorization did not include the newly
joined organization, so the already authorized dashboard was used. This was a
manual SQL Editor application, not a CLI migration-history synchronization.

The editor returned `Success. No rows returned`. An independent metadata query
then confirmed `transactions.updated_at` as nullable `timestamp with time zone`
with default `now()`.

The patch only adds the column and sets its default for future inserts. Existing
rows retain NULL because their modification time is unknown. It does not change
wallet balances, transaction amounts, ownership, RLS, or RPC definitions. The
same repair is included in the full and upgrade scripts for future installations.
Do not rerun those broad scripts to apply this targeted repair.

## Client behavior

- Empty or nonnumeric actual balances cannot silently become zero; entering 0
  explicitly remains supported.
- Duplicate submit clicks send only one in-flight request.
- Both SQL errors and the installed RPC's `success: false, status: STALE_BALANCE`
  response keep the form open without claiming success.
- A success response must identify the requested wallet and confirm a finite,
  matching balance before it updates the local wallet cache.
- Responses from a previous login session cannot announce success or re-enable
  the current session's submit button.

## Verification

`npm test` passed all 87 checks/suites, including 9 new reconciliation regressions.
The new suite executes the actual SQL in disposable PGlite databases and the
actual UI handler in a Node VM. It reproduces the missing-column error, verifies
transaction rollback, checks repeated repair and existing-data preservation,
tests both RPC versions, rejects stale/cross-user requests, and exercises frontend
error, zero-balance, double-submit, and session-change behavior.

Production verification was read-only after the schema repair. No reconciliation
was submitted against a real user's wallet; the user still supplies and confirms
the actual account balance in the app.
