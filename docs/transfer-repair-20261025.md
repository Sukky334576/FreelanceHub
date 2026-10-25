# Bank-to-cash transfer repair — 25 October 2026

## Cause

The production log at 09:24:23 Asia/Bangkok records PostgreSQL error `42703`:
`column "date" of relation "transfers" does not exist`. Inspection confirmed that
the table has `transfer_date DATE NOT NULL`, but the upgraded
`execute_wallet_transfer` function inserts into `date`. The fresh-install function
already uses `transfer_date`; the upgrade script had reintroduced the mismatch.

## Targeted repair

`supabase/migrations/20261025022848_repair_transfer_date_column.sql` replaces only
the known incorrect INSERT column list in the installed RPC. It leaves its
signature, owner, execution grants, approval guard, wallet-ownership checks and
row-locking logic intact. It makes no wallet or ledger changes, and adds no duplicate
date column. The repair is transactional, repeatable, and refuses an unexpected
schema or function layout. The upgrade script now uses `transfer_date` too.

The targeted migration was applied through the authorized Supabase SQL Editor to
the existing `natthawit-app` production project. The editor returned
`Success. No rows returned`. This is a manual SQL Editor application; CLI migration
history was not synchronized. Do not run the broad baseline/upgrade scripts for
this repair.

A separate read-only query confirmed that the deployed definition matches the
captured function with only the column-name repair, after normalizing whitespace
from the dashboard's text rendering. Anonymous execution remains denied and
authenticated execution remains allowed. The transfer table still had zero rows,
as before the repair. Health Advisor reported no errors or warnings; the refreshed
Security Advisor remained at 0 errors and 14 existing warnings. Performance Advisor
before the repair reported 0 errors and 13 existing warnings.

## Verification

`npm test` exited 0 with 128 passing checks, including 9 new transfer regressions.
The new suite executes the deployed faulty function and the repair in disposable
PGlite databases. It covers:

- Reproduction of the missing-column error and rollback of both wallet balances.
- A 400-baht bank-to-cash transfer with the explicitly chosen date on the master
  record and both ledger entries; transfers stay outside operating income/expense.
- Fee accounting, cancellation and preservation of unrelated financial history.
- Rollback of wallet updates and the transfer master when a ledger insert fails.
- Owner isolation, pending-user rejection, anonymous denial and unchanged grants.
- Repeated repair, an upgrade rerun, the fresh-install function and an unexpected
  schema that must fail without adding another date column.

No real user's transfer was submitted during verification. The user should retry
their intended transfer from the app. Application files did not change, so the
backend repair takes effect without a frontend redeployment.
