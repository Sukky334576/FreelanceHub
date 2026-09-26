-- ==============================================================================
-- ASSIGN EXISTING DATA TO REGISTERED OWNER
-- ==============================================================================
-- This assigns all existing transactions, jobs, wallets, bills, equipment
-- to the registered user in auth.users so that Row Level Security (RLS)
-- allows the user to see and manage their data.
-- ==============================================================================

DO $$
DECLARE
  v_owner UUID;
BEGIN
  -- 1. Find the primary owner from auth.users
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at ASC LIMIT 1;
  
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'No user found in auth.users';
  END IF;

  RAISE NOTICE 'Assigning existing rows to owner: %', v_owner;

  -- 2. Assign all existing rows with user_id IS NULL to this owner
  UPDATE public.categories SET user_id = v_owner WHERE user_id IS NULL;
  UPDATE public.jobs SET user_id = v_owner WHERE user_id IS NULL;
  UPDATE public.todos SET user_id = v_owner WHERE user_id IS NULL;
  UPDATE public.bills SET user_id = v_owner WHERE user_id IS NULL;
  UPDATE public.equipment SET user_id = v_owner WHERE user_id IS NULL;
  UPDATE public.wallets SET user_id = v_owner WHERE user_id IS NULL;
  UPDATE public.debts SET user_id = v_owner WHERE user_id IS NULL;
  UPDATE public.debt_payments SET user_id = v_owner WHERE user_id IS NULL;
  UPDATE public.cards SET user_id = v_owner WHERE user_id IS NULL;
  UPDATE public.transfers SET user_id = v_owner WHERE user_id IS NULL;
  UPDATE public.transactions SET user_id = v_owner WHERE user_id IS NULL;

  -- 3. Resolve wallet_id on legacy transactions that have wallet_id IS NULL
  UPDATE public.transactions t
  SET wallet_id = public.resolve_transaction_wallet_id(t.details, t.user_id)
  WHERE t.wallet_id IS NULL AND t.details IS NOT NULL AND t.user_id IS NOT NULL;

END $$;

-- 4. Check the row counts
SELECT 
  (SELECT count(*) FROM public.transactions) AS total_transactions,
  (SELECT count(*) FROM public.transactions WHERE user_id IS NOT NULL) AS active_transactions,
  (SELECT count(*) FROM public.wallets) AS total_wallets,
  (SELECT count(*) FROM public.jobs) AS total_jobs,
  (SELECT count(*) FROM public.bills) AS total_bills,
  (SELECT count(*) FROM public.equipment) AS total_equipment;
