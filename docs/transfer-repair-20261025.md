# Bank-to-cash transfer repairs — 25 October 2026

## Two verified causes

The production log at 09:24:23 Asia/Bangkok recorded PostgreSQL `42703`:
`column "date" of relation "transfers" does not exist`. The upgraded
`execute_wallet_transfer` function wrote `date`, although the real table has
`transfer_date DATE NOT NULL`. The fresh-install RPC already used `transfer_date`.

After that column-name fix, the user's retries at 09:35:46 and 09:37:00 exposed
`23514`: `transactions_type_check` still allowed only `รายรับ` and `รายจ่าย`.
The transfer RPC writes two neutral `โอนเงิน` entries. The earlier tests used the
repository baseline, which had no type CHECK, so they missed the live constraint.
The follow-up inspection captured columns, all constraints and user triggers on
`transactions`, `transfers` and `wallets`. There are no user triggers on those
three production tables. The live type values present were income and expense.

## Targeted production repairs

1. `supabase/migrations/20261025022848_repair_transfer_date_column.sql` changes
   only the known incorrect INSERT column list in the installed transfer RPC.
2. `supabase/migrations/20261025023954_align_transaction_type_constraint.sql`
   replaces the known legacy type CHECK with a validated allow-list containing
   `รายรับ`, `รายจ่าย`, `โอนเงิน`, `ปรับยอดเงิน`, matching existing financial RPCs.
   It does not remove type validation or accept arbitrary strings. Unexpected
   constraint definitions abort for inspection; invalid existing data aborts
   validation without deleting or rewriting records.

Both patches are transactional and repeatable, with a 5-second lock timeout and
15-second statement timeout. They perform no business-data DML and leave wallet
balances, ledger entries, RLS, approval guards, ownership checks and execution
grants intact. The baseline and upgrade scripts now contain the identical type
contract, and the upgrade RPC uses `transfer_date`.

Both targeted migrations were applied through the authorized Supabase SQL Editor
to the existing production project, each returning `Success. No rows returned`.
These are manual applications; CLI migration history was not synchronized. Do not
run the broad baseline/upgrade scripts in production for these repairs.

The follow-up read-only verification returned true for all six checks:

- The new constraint is validated against existing rows.
- Transfer and reconciliation types are included.
- The transfer function is unchanged by the type-constraint repair (normalized
  definition hash compared with the immediately preceding production capture).
- Anonymous execution remains blocked.
- Authenticated execution remains available, subject to the existing RPC guards.

Security Advisor after refresh still reports 0 errors and 14 pre-existing
warnings. This is not a claim that the existing warnings have been resolved.

## Verification and limits

`npm test` exited 0 with **133 passing checks**, including **14 transfer schema
regressions**. They execute real PostgreSQL SQL in disposable **PGlite** databases;
this run is not a native multi-connection concurrency benchmark.

The transfer regressions reproduce both production errors using the captured RPC
and exact live CHECK definitions, enforce live NOT NULL columns, and verify:

- On failure, both balances and all transfer/ledger rows roll back.
- A 400-baht bank-to-cash transfer succeeds with the selected date on all records.
- Transfer legs stay outside operating income/expense; fees remain expenses.
- Cancellation restores balances and preserves unrelated history.
- Injected ledger failure is atomic; owner, approval and anonymous checks remain.
- Type repair preserves existing records, RPC definitions, RLS flags and grants.
- Unknown types are rejected; unknown constraints and invalid old data fail safely.
- Fresh, upgrade and targeted repair share the same contract, including reruns.

The production metadata fixture contains schema definitions only, with no user
IDs, financial records or credentials. No real user's transfer was submitted by
the agent. The user can retry their intended transfer in the app. Runtime assets
are unchanged, so this backend repair requires no frontend redeployment.

PostgreSQL reference: [ALTER TABLE / CHECK validation](https://www.postgresql.org/docs/current/sql-altertable.html).
