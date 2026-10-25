-- Align the verified legacy allow-list with existing financial RPCs.
-- Changes only the type CHECK; no wallet, transaction, RLS or RPC changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

-- BEGIN TRANSACTION TYPE CONTRACT (keep in sync with the versioned repair)
-- Legacy deployments only allowed income/expense. The RPCs also write neutral
-- transfer/reconciliation entries; keep a validated allow-list, not an open type.
DO $transaction_types$
DECLARE
  v_definition TEXT;
  v_legacy CONSTANT TEXT := 'CHECK ((type = ANY (ARRAY[''รายรับ''::text, ''รายจ่าย''::text])))';
  v_current CONSTANT TEXT := 'CHECK ((type = ANY (ARRAY[''รายรับ''::text, ''รายจ่าย''::text, ''โอนเงิน''::text, ''ปรับยอดเงิน''::text])))';
BEGIN
  LOCK TABLE public.transactions IN ACCESS EXCLUSIVE MODE;
  SELECT pg_get_constraintdef(oid) INTO v_definition
    FROM pg_constraint
    WHERE conrelid = 'public.transactions'::regclass
      AND conname = 'transactions_type_check';

  IF v_definition IS NOT NULL AND
     regexp_replace(v_definition, '[[:space:]]+', '', 'g') NOT IN (
       regexp_replace(v_legacy, '[[:space:]]+', '', 'g'),
       regexp_replace(v_current, '[[:space:]]+', '', 'g')) THEN
    RAISE EXCEPTION 'Unexpected transactions_type_check definition; inspect before changing: %', v_definition;
  END IF;

  IF v_definition IS NULL OR
     regexp_replace(v_definition, '[[:space:]]+', '', 'g') =
     regexp_replace(v_legacy, '[[:space:]]+', '', 'g') THEN
    ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_check
      CHECK (type IN ('รายรับ', 'รายจ่าย', 'โอนเงิน', 'ปรับยอดเงิน')) NOT VALID;
  END IF;
  -- Existing rows must pass too. If validation fails, this entire block rolls
  -- back, retaining the original constraint and all financial data.
  ALTER TABLE public.transactions VALIDATE CONSTRAINT transactions_type_check;
END;
$transaction_types$;
-- END TRANSACTION TYPE CONTRACT

NOTIFY pgrst, 'reload schema';
COMMIT;
