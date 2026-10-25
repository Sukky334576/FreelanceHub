-- Repair the upgraded RPC's INSERT target; the table already uses transfer_date.
-- Patch only the known column list, preserving the deployed approval/owner checks,
-- row locks, signature, function owner and EXECUTE grants. No financial rows change.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
DO $repair$
DECLARE
  target_oid regprocedure := to_regprocedure('public.execute_wallet_transfer(bigint,bigint,numeric,numeric,date,text)');
  definition text;
  repaired text;
  old_columns text := 'user_id, from_wallet_id, to_wallet_id, amount, fee, date, notes, created_at';
  new_columns text := 'user_id, from_wallet_id, to_wallet_id, amount, fee, transfer_date, notes, created_at';
BEGIN
  IF target_oid IS NULL THEN
    RAISE EXCEPTION 'Transfer repair stopped: expected RPC is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transfers'
      AND column_name = 'transfer_date' AND data_type = 'date'
  ) THEN
    RAISE EXCEPTION 'Transfer repair stopped: expected transfers.transfer_date DATE is missing';
  END IF;

  definition := pg_get_functiondef(target_oid);
  IF strpos(definition, old_columns) > 0 THEN
    -- The known faulty list must be the INSERT into transfers, not another table.
    IF definition !~ 'INSERT INTO public[.]transfers[[:space:]]*[(][[:space:]]*user_id, from_wallet_id, to_wallet_id, amount, fee, date, notes, created_at[[:space:]]*[)]' THEN
      RAISE EXCEPTION 'Transfer repair stopped: unexpected INSERT layout; inspect the RPC';
    END IF;
    repaired := replace(definition, old_columns, new_columns);
    EXECUTE repaired;
  ELSIF definition ~ 'INSERT INTO public[.]transfers[[:space:]]*[(][[:space:]]*user_id, from_wallet_id, to_wallet_id, amount, fee, transfer_date, notes' THEN
    NULL; -- Already repaired, including the working fresh-install RPC.
  ELSE
    RAISE EXCEPTION 'Transfer repair stopped: unknown RPC definition; inspect before changing';
  END IF;
END;
$repair$;
NOTIFY pgrst, 'reload schema';
COMMIT;
