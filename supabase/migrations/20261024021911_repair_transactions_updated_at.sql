-- Repair legacy tables skipped by CREATE TABLE IF NOT EXISTS.
-- Existing rows keep NULL when their original modification time is unknown.
-- This migration does not modify ledger amounts, wallet balances, or permissions.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE public.transactions ALTER COLUMN updated_at SET DEFAULT NOW();
NOTIFY pgrst, 'reload schema';
COMMIT;
