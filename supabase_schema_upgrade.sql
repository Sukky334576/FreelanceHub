-- ==============================================================================
-- FreelanceHub / Natthawit Studio - Supabase Schema Upgrade Script (RR01 - RR06)
-- Run this script in the Supabase SQL Editor to resolve all Codex findings on live DB
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 0. BASELINE TABLES IF NOT EXISTS (Guarantees missing tables exist before ALTER)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  color TEXT DEFAULT '#168EA1',
  icon TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.jobs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  title TEXT NOT NULL,
  client TEXT,
  date DATE,
  end_date DATE,
  time_slot TEXT,
  location TEXT,
  budget NUMERIC(14, 2) DEFAULT 0.00,
  advance_amount NUMERIC(14, 2) DEFAULT 0.00,
  final_amount NUMERIC(14, 2) DEFAULT 0.00,
  paid_amount NUMERIC(14, 2) DEFAULT 0.00,
  profit NUMERIC(14, 2) DEFAULT 0.00,
  job_type TEXT,
  status TEXT DEFAULT 'pending',
  description TEXT,
  remark TEXT,
  is_complete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.todos (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  title TEXT NOT NULL,
  date DATE DEFAULT CURRENT_DATE,
  time_slot TEXT,
  tag TEXT DEFAULT 'ทั่วไป',
  is_complete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bills (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  item TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  due_date INTEGER DEFAULT 1,
  is_paid BOOLEAN DEFAULT FALSE,
  note TEXT,
  notes TEXT,
  last_paid_date DATE,
  last_paid_tx_id BIGINT,
  linked_wallet_id BIGINT,
  linked_debt_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.equipment (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  name TEXT NOT NULL,
  cost NUMERIC(14, 2) DEFAULT 0.00,
  purchase_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.wallets (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'bank',
  color TEXT DEFAULT '#168EA1',
  icon TEXT DEFAULT 'fa-building-columns',
  balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  opening_date DATE DEFAULT CURRENT_DATE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.debts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  name TEXT NOT NULL,
  lender TEXT,
  debt_type TEXT NOT NULL DEFAULT 'installment',
  original_principal NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  remaining_principal NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  interest_method TEXT NOT NULL DEFAULT 'zero',
  interest_rate NUMERIC(8, 4) DEFAULT 0.00,
  rate_unit TEXT DEFAULT 'annual',
  term_months INTEGER DEFAULT 1,
  paid_months INTEGER DEFAULT 0,
  monthly_payment NUMERIC(14, 2) DEFAULT 0.00,
  due_day INTEGER DEFAULT 1,
  default_wallet_id BIGINT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.debt_payments (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  debt_id BIGINT NOT NULL,
  wallet_id BIGINT,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(14, 2) NOT NULL,
  total_amount NUMERIC(14, 2),
  principal_paid NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  principal_amount NUMERIC(14, 2),
  interest_paid NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  interest_amount NUMERIC(14, 2),
  fee_paid NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  transaction_id BIGINT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cards (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  name TEXT NOT NULL,
  issuer TEXT NOT NULL,
  card_type TEXT NOT NULL DEFAULT 'credit',
  last_four VARCHAR(4),
  closing_day INTEGER NOT NULL DEFAULT 20,
  due_day INTEGER NOT NULL DEFAULT 10,
  credit_limit NUMERIC(14, 2) DEFAULT 0.00,
  current_balance NUMERIC(14, 2) DEFAULT 0.00,
  default_payment_mode TEXT DEFAULT 'full',
  default_wallet_id BIGINT,
  color TEXT DEFAULT '#164F57',
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.transfers (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  from_wallet_id BIGINT NOT NULL,
  to_wallet_id BIGINT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  fee NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (fee >= 0),
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  time TIME DEFAULT CURRENT_TIME,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  details TEXT,
  slip_url TEXT,
  wallet_id BIGINT,
  job_id BIGINT,
  debt_id BIGINT,
  card_id BIGINT,
  transfer_id BIGINT,
  bill_id BIGINT,
  related_job TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 1. SAFE COLUMN & CONSTRAINT ADDITIONS (RR01, RR03, RR05)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  -- Ensure user_id on all operational tables
  ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
  ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
  ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
  ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
  ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
  ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
  ALTER TABLE public.debt_payments ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
  ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
  ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();

  -- Form & relational columns on jobs
  ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS end_date DATE;
  ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS time_slot TEXT;
  ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS advance_amount NUMERIC(14, 2) DEFAULT 0.00;
  ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS final_amount NUMERIC(14, 2) DEFAULT 0.00;
  ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS profit NUMERIC(14, 2) DEFAULT 0.00;
  ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS description TEXT;
  ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS remark TEXT;

  -- Form & relational columns on bills
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS last_paid_tx_id BIGINT;
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS linked_wallet_id BIGINT;
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS linked_debt_id BIGINT;
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS notes TEXT;
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS note TEXT;
  UPDATE public.bills SET notes = note WHERE notes IS NULL AND note IS NOT NULL;
  UPDATE public.bills SET note = notes WHERE note IS NULL AND notes IS NOT NULL;

  -- Form & relational columns on transfers
  ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS notes TEXT;
  ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS note TEXT;
  UPDATE public.transfers SET notes = note WHERE notes IS NULL AND note IS NOT NULL;
  UPDATE public.transfers SET note = notes WHERE note IS NULL AND notes IS NOT NULL;

  -- Relational columns on transactions
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS wallet_id BIGINT;
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS job_id BIGINT;
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS debt_id BIGINT;
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS card_id BIGINT;
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transfer_id BIGINT;
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS bill_id BIGINT;
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS related_job TEXT;
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS request_id TEXT;
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS time TIME DEFAULT CURRENT_TIME;
  ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS slip_url TEXT;

  -- Categories styling
  ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#168EA1';

  -- Debt payments column alignment
  ALTER TABLE public.debt_payments ADD COLUMN IF NOT EXISTS total_amount NUMERIC(14, 2);
  ALTER TABLE public.debt_payments ADD COLUMN IF NOT EXISTS amount NUMERIC(14, 2);
  ALTER TABLE public.debt_payments ADD COLUMN IF NOT EXISTS principal_paid NUMERIC(14, 2);
  ALTER TABLE public.debt_payments ADD COLUMN IF NOT EXISTS principal_amount NUMERIC(14, 2);
  ALTER TABLE public.debt_payments ADD COLUMN IF NOT EXISTS interest_paid NUMERIC(14, 2);
  ALTER TABLE public.debt_payments ADD COLUMN IF NOT EXISTS interest_amount NUMERIC(14, 2);
  UPDATE public.debt_payments SET total_amount = amount WHERE total_amount IS NULL AND amount IS NOT NULL;
  UPDATE public.debt_payments SET amount = total_amount WHERE amount IS NULL AND total_amount IS NOT NULL;
  UPDATE public.debt_payments SET principal_paid = principal_amount WHERE principal_paid IS NULL AND principal_amount IS NOT NULL;
  UPDATE public.debt_payments SET principal_amount = principal_paid WHERE principal_amount IS NULL AND principal_paid IS NOT NULL;
  UPDATE public.debt_payments SET interest_paid = interest_amount WHERE interest_paid IS NULL AND interest_amount IS NOT NULL;
  UPDATE public.debt_payments SET interest_amount = interest_paid WHERE interest_amount IS NULL AND interest_paid IS NOT NULL;
END $$;

-- Upgrade fk_transactions_transfer to ON DELETE SET NULL to preserve ledger history
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.conname = 'fk_transactions_transfer' AND t.relname = 'transactions'
  ) THEN
    ALTER TABLE public.transactions DROP CONSTRAINT fk_transactions_transfer;
  END IF;

  UPDATE public.transactions 
  SET transfer_id = NULL 
  WHERE transfer_id IS NOT NULL 
    AND transfer_id NOT IN (SELECT id FROM public.transfers);

  ALTER TABLE public.transactions 
  ADD CONSTRAINT fk_transactions_transfer 
  FOREIGN KEY (transfer_id) REFERENCES public.transfers(id) ON DELETE SET NULL;
END $$;

-- Indexes for performance and idempotency
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_user_request_id ON public.transactions(user_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON public.transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_job_id ON public.transactions(job_id);

-- ------------------------------------------------------------------------------
-- 2. RESOLVE LEGACY TRANSACTION WALLET IDENTITY (RR02)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_transaction_wallet_id(
  p_details TEXT,
  p_user_id UUID
)
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_account_name TEXT := NULL;
  v_wallet_id BIGINT := NULL;
  v_json JSONB;
  v_bracket_end INT;
  v_bracket_inner TEXT;
  v_pipe_pos INT;
BEGIN
  IF p_details IS NULL OR trim(p_details) = '' OR p_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  p_details := trim(p_details);

  -- 1. Check JSON format: e.g. {"account":"บัญชี A", ...} or {"wallet":"บัญชี A", ...}
  IF left(p_details, 1) = '{' THEN
    BEGIN
      v_json := p_details::jsonb;
      IF v_json ? 'account' AND NULLIF(trim(v_json->>'account'), '') IS NOT NULL THEN
        v_account_name := trim(v_json->>'account');
      ELSIF v_json ? 'wallet' AND NULLIF(trim(v_json->>'wallet'), '') IS NOT NULL THEN
        v_account_name := trim(v_json->>'wallet');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_account_name := NULL;
    END;
  END IF;

  -- 2. Check Bracket format: e.g. [สตูดิโอ | บัญชี A] ... or [ส่วนตัว | บัญชี A] ... or [บัญชี A] ...
  IF v_account_name IS NULL AND left(p_details, 1) = '[' THEN
    v_bracket_end := position(']' in p_details);
    IF v_bracket_end > 2 THEN
      v_bracket_inner := substring(p_details from 2 for v_bracket_end - 2);
      v_pipe_pos := position('|' in v_bracket_inner);
      IF v_pipe_pos > 0 THEN
        v_account_name := trim(substring(v_bracket_inner from v_pipe_pos + 1));
      ELSE
        v_account_name := trim(v_bracket_inner);
      END IF;
    END IF;
  END IF;

  -- 3. Match against wallets owned by user
  IF v_account_name IS NOT NULL AND v_account_name <> '' THEN
    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE user_id = p_user_id AND name = v_account_name
    ORDER BY id ASC
    LIMIT 1;
  END IF;

  RETURN v_wallet_id;
END;
$$;

-- Backfill legacy transactions where wallet_id is NULL
UPDATE public.transactions t
SET wallet_id = public.resolve_transaction_wallet_id(t.details, t.user_id)
WHERE t.wallet_id IS NULL AND t.details IS NOT NULL AND t.user_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 3. DROP OBSOLETE OVERLOADS SAFELY (RR01)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.execute_wallet_transfer(BIGINT, BIGINT, NUMERIC, NUMERIC, DATE, TEXT);
DROP FUNCTION IF EXISTS public.cancel_wallet_transfer(BIGINT);
DROP FUNCTION IF EXISTS public.cancel_wallet_transfer_by_tx(BIGINT);
DROP FUNCTION IF EXISTS public.execute_wallet_reconciliation(BIGINT, NUMERIC, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.execute_wallet_reconciliation(BIGINT, NUMERIC, NUMERIC, TEXT, DATE);
DROP FUNCTION IF EXISTS public.execute_bill_payment(BIGINT, BIGINT, DATE);
DROP FUNCTION IF EXISTS public.cancel_bill_payment(BIGINT);
DROP FUNCTION IF EXISTS public.execute_debt_payment(BIGINT, BIGINT, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT);
DROP FUNCTION IF EXISTS public.execute_create_transaction(DATE, TEXT, TEXT, NUMERIC, TEXT, BIGINT, BIGINT, BIGINT);
DROP FUNCTION IF EXISTS public.execute_create_transaction(DATE, TEXT, TEXT, NUMERIC, TEXT, TEXT, BIGINT, BIGINT, BIGINT, TEXT);
DROP FUNCTION IF EXISTS public.execute_update_transaction(BIGINT, DATE, TEXT, TEXT, NUMERIC, TEXT, BIGINT, BIGINT, BIGINT);
DROP FUNCTION IF EXISTS public.execute_update_transaction(BIGINT, DATE, TEXT, TEXT, NUMERIC, TEXT, TEXT, BIGINT, BIGINT, BIGINT);
DROP FUNCTION IF EXISTS public.execute_delete_transaction(BIGINT);

-- ------------------------------------------------------------------------------
-- 4. ENFORCE ROW LEVEL SECURITY & REVOKE ANON ACCESS (RR06)
-- ------------------------------------------------------------------------------
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wallets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.debts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.debt_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cards FORCE ROW LEVEL SECURITY;
ALTER TABLE public.transfers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bills FORCE ROW LEVEL SECURITY;
ALTER TABLE public.jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.todos FORCE ROW LEVEL SECURITY;
ALTER TABLE public.equipment FORCE ROW LEVEL SECURITY;
ALTER TABLE public.categories FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.transactions FROM anon;
REVOKE ALL ON public.wallets FROM anon;
REVOKE ALL ON public.debts FROM anon;
REVOKE ALL ON public.debt_payments FROM anon;
REVOKE ALL ON public.cards FROM anon;
REVOKE ALL ON public.transfers FROM anon;
REVOKE ALL ON public.bills FROM anon;
REVOKE ALL ON public.jobs FROM anon;
REVOKE ALL ON public.todos FROM anon;
REVOKE ALL ON public.equipment FROM anon;
REVOKE ALL ON public.categories FROM anon;

-- Ensure authenticated users have table access (governed strictly by RLS policies)
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Drop obsolete or permissive policies
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN 
    SELECT policyname, tablename 
    FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename IN ('transactions', 'wallets', 'debts', 'debt_payments', 'cards', 'transfers', 'bills', 'jobs', 'todos', 'equipment', 'categories')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- Create strict owner-only policies (user_id = auth.uid())
CREATE POLICY "owner_all_categories" ON public.categories FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "owner_all_jobs" ON public.jobs FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "owner_all_todos" ON public.todos FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "owner_all_bills" ON public.bills FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "owner_all_equipment" ON public.equipment FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "owner_all_transactions" ON public.transactions FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "owner_all_wallets" ON public.wallets FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "owner_all_debts" ON public.debts FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "owner_all_debt_payments" ON public.debt_payments FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "owner_all_cards" ON public.cards FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "owner_all_transfers" ON public.transfers FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- ------------------------------------------------------------------------------
-- 5. ATOMIC STORED PROCEDURES (PROCEDURES 1 TO 10)
-- ------------------------------------------------------------------------------

-- Procedure 0: Atomic Balance Adjustment
CREATE OR REPLACE FUNCTION public.adjust_wallet_balance(p_wallet_id BIGINT, p_delta NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance NUMERIC;
  v_owner UUID;
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;

  -- Lock row and verify existence
  SELECT user_id, balance INTO v_owner, v_new_balance
  FROM public.wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet with ID % not found', p_wallet_id;
  END IF;

  -- Ownership verification
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: wallet not owned by authenticated user';
  END IF;

  UPDATE public.wallets
  SET balance = balance + p_delta,
      updated_at = NOW()
  WHERE id = p_wallet_id
  RETURNING balance INTO v_new_balance;

  RETURN v_new_balance;
END;
$$;

-- Procedure 1: Atomic Wallet Transfer
CREATE OR REPLACE FUNCTION public.execute_wallet_transfer(
  p_from_id BIGINT,
  p_to_id BIGINT,
  p_amount NUMERIC,
  p_fee NUMERIC DEFAULT 0.00,
  p_date DATE DEFAULT CURRENT_DATE,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer_id BIGINT;
  v_from_bal NUMERIC;
  v_to_bal NUMERIC;
  v_from_name TEXT;
  v_to_name TEXT;
  v_out_tx_id BIGINT;
  v_in_tx_id BIGINT;
  v_fee_tx_id BIGINT;
  v_from_owner UUID;
  v_to_owner UUID;
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;

  IF p_from_id = p_to_id THEN
    RAISE EXCEPTION 'Cannot transfer to the same wallet';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be greater than zero';
  END IF;
  IF p_fee < 0 THEN
    RAISE EXCEPTION 'Fee cannot be negative';
  END IF;

  IF p_from_id < p_to_id THEN
    SELECT user_id, name INTO v_from_owner, v_from_name FROM public.wallets WHERE id = p_from_id FOR UPDATE;
    SELECT user_id, name INTO v_to_owner, v_to_name FROM public.wallets WHERE id = p_to_id FOR UPDATE;
  ELSE
    SELECT user_id, name INTO v_to_owner, v_to_name FROM public.wallets WHERE id = p_to_id FOR UPDATE;
    SELECT user_id, name INTO v_from_owner, v_from_name FROM public.wallets WHERE id = p_from_id FOR UPDATE;
  END IF;

  IF v_from_owner IS NULL OR v_from_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: source wallet not owned by user';
  END IF;
  IF v_to_owner IS NULL OR v_to_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: target wallet not owned by user';
  END IF;

  UPDATE public.wallets
  SET balance = balance - (p_amount + p_fee), updated_at = NOW()
  WHERE id = p_from_id
  RETURNING balance INTO v_from_bal;

  UPDATE public.wallets
  SET balance = balance + p_amount, updated_at = NOW()
  WHERE id = p_to_id
  RETURNING balance INTO v_to_bal;

  INSERT INTO public.transfers (
    user_id, from_wallet_id, to_wallet_id, amount, fee, date, notes, created_at
  ) VALUES (
    auth.uid(), p_from_id, p_to_id, p_amount, p_fee, p_date, p_note, NOW()
  )
  RETURNING id INTO v_transfer_id;

  INSERT INTO public.transactions (
    user_id, date, type, category, amount, details, wallet_id, transfer_id, created_at, updated_at
  ) VALUES (
    auth.uid(), p_date, 'โอนเงิน', 'โอนเงิน', p_amount,
    COALESCE(p_note, 'โอนเงินออกไป ' || v_to_name), p_from_id, v_transfer_id, NOW(), NOW()
  )
  RETURNING id INTO v_out_tx_id;

  INSERT INTO public.transactions (
    user_id, date, type, category, amount, details, wallet_id, transfer_id, created_at, updated_at
  ) VALUES (
    auth.uid(), p_date, 'โอนเงิน', 'โอนเงิน', p_amount,
    COALESCE(p_note, 'รับโอนเงินมาจาก ' || v_from_name), p_to_id, v_transfer_id, NOW(), NOW()
  )
  RETURNING id INTO v_in_tx_id;

  IF p_fee > 0 THEN
    INSERT INTO public.transactions (
      user_id, date, type, category, amount, details, wallet_id, transfer_id, created_at, updated_at
    ) VALUES (
      auth.uid(), p_date, 'รายจ่าย', 'ค่าธรรมเนียม', p_fee,
      'ค่าธรรมเนียมโอนเงิน', p_from_id, v_transfer_id, NOW(), NOW()
    )
    RETURNING id INTO v_fee_tx_id;
  END IF;

  RETURN jsonb_build_object(
    'transfer_id', v_transfer_id,
    'from_wallet_id', p_from_id,
    'from_balance', v_from_bal,
    'to_wallet_id', p_to_id,
    'to_balance', v_to_bal,
    'out_tx_id', v_out_tx_id,
    'in_tx_id', v_in_tx_id,
    'fee_tx_id', v_fee_tx_id
  );
END;
$$;

-- Procedure 2: Cancel Wallet Transfer
CREATE OR REPLACE FUNCTION public.cancel_wallet_transfer(
  p_transfer_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_tr RECORD;
  v_from_bal NUMERIC;
  v_to_bal NUMERIC;
  v_from_owner UUID;
  v_to_owner UUID;
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;
  v_user_id := auth.uid();

  SELECT * INTO v_tr FROM public.transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer with ID % not found', p_transfer_id;
  END IF;
  IF v_tr.user_id IS NULL OR v_tr.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Forbidden: transfer not owned by user';
  END IF;

  IF v_tr.from_wallet_id < v_tr.to_wallet_id THEN
    SELECT user_id INTO v_from_owner FROM public.wallets WHERE id = v_tr.from_wallet_id FOR UPDATE;
    SELECT user_id INTO v_to_owner FROM public.wallets WHERE id = v_tr.to_wallet_id FOR UPDATE;
  ELSE
    SELECT user_id INTO v_to_owner FROM public.wallets WHERE id = v_tr.to_wallet_id FOR UPDATE;
    SELECT user_id INTO v_from_owner FROM public.wallets WHERE id = v_tr.from_wallet_id FOR UPDATE;
  END IF;

  IF v_from_owner IS NULL OR v_from_owner <> v_user_id THEN
    RAISE EXCEPTION 'Forbidden: source wallet not owned by user';
  END IF;
  IF v_to_owner IS NULL OR v_to_owner <> v_user_id THEN
    RAISE EXCEPTION 'Forbidden: target wallet not owned by user';
  END IF;

  UPDATE public.wallets
  SET balance = balance + (v_tr.amount + v_tr.fee), updated_at = NOW()
  WHERE id = v_tr.from_wallet_id
  RETURNING balance INTO v_from_bal;

  UPDATE public.wallets
  SET balance = balance - v_tr.amount, updated_at = NOW()
  WHERE id = v_tr.to_wallet_id
  RETURNING balance INTO v_to_bal;

  DELETE FROM public.transactions WHERE transfer_id = p_transfer_id;
  DELETE FROM public.transfers WHERE id = p_transfer_id;

  RETURN jsonb_build_object(
    'cancelled_transfer_id', p_transfer_id,
    'from_wallet_id', v_tr.from_wallet_id,
    'from_balance', v_from_bal,
    'to_wallet_id', v_tr.to_wallet_id,
    'to_balance', v_to_bal
  );
END;
$$;

-- Procedure 3: Cancel Wallet Transfer by Tx ID
CREATE OR REPLACE FUNCTION public.cancel_wallet_transfer_by_tx(
  p_tx_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_transfer_id BIGINT;
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;
  v_user_id := auth.uid();

  SELECT transfer_id INTO v_transfer_id
  FROM public.transactions
  WHERE id = p_tx_id AND user_id = v_user_id;

  IF v_transfer_id IS NULL THEN
    RAISE EXCEPTION 'Transaction is not part of a transfer or not found';
  END IF;

  RETURN public.cancel_wallet_transfer(v_transfer_id);
END;
$$;

-- Procedure 4: Atomic Reconciliation with Custom Date (RR01)
CREATE OR REPLACE FUNCTION public.execute_wallet_reconciliation(
  p_wallet_id BIGINT,
  p_expected_balance NUMERIC,
  p_actual_balance NUMERIC,
  p_note TEXT DEFAULT NULL,
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_wallet RECORD;
  v_diff NUMERIC;
  v_tx_id BIGINT;
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;
  v_user_id := auth.uid();

  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet with ID % not found', p_wallet_id;
  END IF;
  IF v_wallet.user_id IS NULL OR v_wallet.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Forbidden: wallet not owned by user';
  END IF;

  IF ROUND(v_wallet.balance::NUMERIC, 2) <> ROUND(p_expected_balance::NUMERIC, 2) THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'STALE_BALANCE',
      'message', 'ยอดเงินในระบบมีการเปลี่ยนแปลง กรุณารีเฟรชก่อนกระทบยอดใหม่',
      'current_balance', v_wallet.balance,
      'expected_balance', p_expected_balance
    );
  END IF;

  v_diff := ROUND((p_actual_balance - v_wallet.balance)::NUMERIC, 2);

  UPDATE public.wallets
  SET balance = p_actual_balance, updated_at = NOW()
  WHERE id = p_wallet_id;

  IF v_diff <> 0 THEN
    INSERT INTO public.transactions (
      user_id, date, type, category, amount, details, wallet_id, created_at, updated_at
    ) VALUES (
      v_user_id, p_date, 'ปรับยอดเงิน', 'ปรับยอดเงิน', ABS(v_diff),
      COALESCE(p_note, 'ปรับยอดเงินจากการกระทบยอด'),
      p_wallet_id, NOW(), NOW()
    )
    RETURNING id INTO v_tx_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'OK',
    'wallet_id', p_wallet_id,
    'old_balance', v_wallet.balance,
    'new_balance', p_actual_balance,
    'diff', v_diff,
    'transaction_id', v_tx_id
  );
END;
$$;

-- Procedure 5: Atomic Bill Payment
CREATE OR REPLACE FUNCTION public.execute_bill_payment(
  p_bill_id BIGINT,
  p_wallet_id BIGINT,
  p_payment_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_bill RECORD;
  v_wallet RECORD;
  v_tx_id BIGINT;
  v_new_balance NUMERIC;
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;
  v_user_id := auth.uid();

  SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill with ID % not found', p_bill_id;
  END IF;
  IF v_bill.user_id IS NULL OR v_bill.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Forbidden: bill not owned by user';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet with ID % not found', p_wallet_id;
  END IF;
  IF v_wallet.user_id IS NULL OR v_wallet.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Forbidden: wallet not owned by user';
  END IF;

  IF v_bill.is_paid THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'ALREADY_PAID',
      'message', 'บิลนี้ถูกทำเครื่องหมายว่าชำระแล้ว'
    );
  END IF;

  UPDATE public.wallets
  SET balance = balance - v_bill.amount, updated_at = NOW()
  WHERE id = p_wallet_id
  RETURNING balance INTO v_new_balance;

  INSERT INTO public.transactions (
    user_id, date, type, category, amount, details, wallet_id, bill_id, created_at, updated_at
  ) VALUES (
    v_user_id, p_payment_date, 'รายจ่าย', v_bill.category, v_bill.amount,
    'ชำระบิล: ' || v_bill.title, p_wallet_id, p_bill_id, NOW(), NOW()
  )
  RETURNING id INTO v_tx_id;

  UPDATE public.bills
  SET is_paid = TRUE, last_paid_tx_id = v_tx_id, linked_wallet_id = p_wallet_id, updated_at = NOW()
  WHERE id = p_bill_id;

  RETURN jsonb_build_object(
    'success', true,
    'bill_id', p_bill_id,
    'transaction_id', v_tx_id,
    'wallet_id', p_wallet_id,
    'new_wallet_balance', v_new_balance
  );
END;
$$;

-- Procedure 6: Cancel Bill Payment
CREATE OR REPLACE FUNCTION public.cancel_bill_payment(
  p_bill_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_bill RECORD;
  v_tx RECORD;
  v_wallet RECORD;
  v_new_balance NUMERIC;
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;
  v_user_id := auth.uid();

  SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill with ID % not found', p_bill_id;
  END IF;
  IF v_bill.user_id IS NULL OR v_bill.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Forbidden: bill not owned by user';
  END IF;

  IF NOT v_bill.is_paid THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'NOT_PAID',
      'message', 'บิลนี้ยังไม่ได้ชำระ'
    );
  END IF;

  IF v_bill.last_paid_tx_id IS NOT NULL THEN
    SELECT * INTO v_tx FROM public.transactions WHERE id = v_bill.last_paid_tx_id FOR UPDATE;
    IF FOUND AND v_tx.wallet_id IS NOT NULL THEN
      SELECT * INTO v_wallet FROM public.wallets WHERE id = v_tx.wallet_id FOR UPDATE;
      IF FOUND AND (v_wallet.user_id = v_user_id) THEN
        UPDATE public.wallets
        SET balance = balance + v_tx.amount, updated_at = NOW()
        WHERE id = v_tx.wallet_id
        RETURNING balance INTO v_new_balance;
      END IF;
    END IF;
    DELETE FROM public.transactions WHERE id = v_bill.last_paid_tx_id;
  END IF;

  UPDATE public.bills
  SET is_paid = FALSE, last_paid_tx_id = NULL, updated_at = NOW()
  WHERE id = p_bill_id;

  RETURN jsonb_build_object(
    'success', true,
    'bill_id', p_bill_id,
    'new_wallet_balance', v_new_balance
  );
END;
$$;

-- Procedure 7: Atomic Debt Payment with Split Principal and Interest
CREATE OR REPLACE FUNCTION public.execute_debt_payment(
  p_debt_id BIGINT,
  p_wallet_id BIGINT,
  p_principal_amount NUMERIC,
  p_interest_amount NUMERIC DEFAULT 0.00,
  p_total_amount NUMERIC DEFAULT NULL,
  p_payment_date DATE DEFAULT CURRENT_DATE,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_debt RECORD;
  v_wallet RECORD;
  v_computed_total NUMERIC;
  v_payment_id BIGINT;
  v_principal_tx_id BIGINT := NULL;
  v_interest_tx_id BIGINT := NULL;
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;
  v_user_id := auth.uid();

  v_computed_total := COALESCE(p_total_amount, (p_principal_amount + p_interest_amount));
  IF v_computed_total <= 0 THEN
    RAISE EXCEPTION 'Payment total amount must be greater than zero';
  END IF;

  SELECT * INTO v_debt FROM public.debts WHERE id = p_debt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debt with ID % not found', p_debt_id;
  END IF;
  IF v_debt.user_id IS NULL OR v_debt.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Forbidden: debt not owned by user';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet with ID % not found', p_wallet_id;
  END IF;
  IF v_wallet.user_id IS NULL OR v_wallet.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Forbidden: wallet not owned by user';
  END IF;

  UPDATE public.wallets
  SET balance = balance - v_computed_total, updated_at = NOW()
  WHERE id = p_wallet_id;

  UPDATE public.debts
  SET remaining_principal = GREATEST(0, remaining_principal - p_principal_amount),
      status = CASE WHEN (remaining_principal - p_principal_amount) <= 0 THEN 'paid_off' ELSE status END,
      updated_at = NOW()
  WHERE id = p_debt_id;

  INSERT INTO public.debt_payments (
    user_id, debt_id, wallet_id, payment_date,
    principal_paid, principal_amount, interest_paid, interest_amount,
    total_amount, amount, note, created_at
  ) VALUES (
    v_user_id, p_debt_id, p_wallet_id, p_payment_date,
    p_principal_amount, p_principal_amount, p_interest_amount, p_interest_amount,
    v_computed_total, v_computed_total, p_note, NOW()
  )
  RETURNING id INTO v_payment_id;

  IF p_principal_amount > 0 THEN
    INSERT INTO public.transactions (
      user_id, date, type, category, amount, details, wallet_id, debt_id, created_at, updated_at
    ) VALUES (
      v_user_id, p_payment_date, 'รายจ่าย', 'ชำระหนี้/ผ่อนสินค้า', p_principal_amount,
      'ชำระเงินต้น: ' || v_debt.title || COALESCE(' (' || p_note || ')', ''),
      p_wallet_id, p_debt_id, NOW(), NOW()
    )
    RETURNING id INTO v_principal_tx_id;
  END IF;

  IF p_interest_amount > 0 THEN
    INSERT INTO public.transactions (
      user_id, date, type, category, amount, details, wallet_id, debt_id, created_at, updated_at
    ) VALUES (
      v_user_id, p_payment_date, 'รายจ่าย', 'ดอกเบี้ยจ่าย', p_interest_amount,
      'ดอกเบี้ยหนี้สิน: ' || v_debt.title || COALESCE(' (' || p_note || ')', ''),
      p_wallet_id, p_debt_id, NOW(), NOW()
    )
    RETURNING id INTO v_interest_tx_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'debt_id', p_debt_id,
    'principal_tx_id', v_principal_tx_id,
    'interest_tx_id', v_interest_tx_id,
    'total_amount', v_computed_total,
    'principal_amount', p_principal_amount,
    'interest_amount', p_interest_amount,
    'remaining_principal', GREATEST(0, v_debt.remaining_principal - p_principal_amount),
    'new_wallet_balance', (v_wallet.balance - v_computed_total)
  );
END;
$$;

-- Procedure 8: Atomic Transaction Creation with Idempotency Key (RR05, RR03, N01, N02)
CREATE OR REPLACE FUNCTION public.execute_create_transaction(
  p_date DATE,
  p_type TEXT,
  p_category TEXT,
  p_amount NUMERIC,
  p_details TEXT DEFAULT NULL,
  p_related_job TEXT DEFAULT NULL,
  p_wallet_id BIGINT DEFAULT NULL,
  p_card_id BIGINT DEFAULT NULL,
  p_job_id BIGINT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_wallet RECORD;
  v_delta NUMERIC := 0;
  v_new_balance NUMERIC := NULL;
  v_tx RECORD;
  v_existing_tx RECORD;
  v_job_title TEXT := NULL;
  v_resolved_job RECORD;
  v_req_id TEXT := NULL;
BEGIN
  -- 1. Session authorization
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;
  v_user_id := auth.uid();

  -- 2. Validate amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount: must be greater than zero';
  END IF;

  -- Canonicalize request_id
  IF p_request_id IS NOT NULL AND trim(p_request_id) <> '' THEN
    v_req_id := trim(p_request_id);
  END IF;

  -- 3. Resolve and validate job ownership (RR03) before idempotency check
  IF p_job_id IS NOT NULL THEN
    SELECT title INTO v_job_title FROM public.jobs WHERE id = p_job_id AND user_id = v_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_JOB: Job does not exist or belong to user';
    END IF;
    IF p_related_job IS NULL THEN
      p_related_job := v_job_title;
    END IF;
  ELSIF p_related_job IS NOT NULL AND p_related_job ~ '^[0-9]+$' THEN
    SELECT id, title INTO v_resolved_job FROM public.jobs WHERE id = p_related_job::bigint AND user_id = v_user_id;
    IF FOUND THEN
      p_job_id := v_resolved_job.id;
      p_related_job := v_resolved_job.title;
    END IF;
  END IF;

  -- 4. Fast pre-check for idempotency (RR05, N01)
  IF v_req_id IS NOT NULL THEN
    SELECT * INTO v_existing_tx 
    FROM public.transactions 
    WHERE user_id = v_user_id AND request_id = v_req_id;

    IF FOUND THEN
      -- Strict null-safe payload comparison across all operation-defining fields (N01)
      IF v_existing_tx.amount IS DISTINCT FROM ROUND(p_amount, 2) OR
         v_existing_tx.type IS DISTINCT FROM p_type OR
         v_existing_tx.date IS DISTINCT FROM p_date OR
         v_existing_tx.category IS DISTINCT FROM p_category OR
         v_existing_tx.details IS DISTINCT FROM p_details OR
         v_existing_tx.wallet_id IS DISTINCT FROM p_wallet_id OR
         v_existing_tx.card_id IS DISTINCT FROM p_card_id OR
         v_existing_tx.job_id IS DISTINCT FROM p_job_id OR
         v_existing_tx.related_job IS DISTINCT FROM p_related_job THEN
        RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: request_id % already used with different payload', v_req_id;
      END IF;

      -- Read balance ONLY from recorded operation's wallet, verifying owner (N01)
      IF v_existing_tx.wallet_id IS NOT NULL THEN
        SELECT balance INTO v_new_balance 
        FROM public.wallets 
        WHERE id = v_existing_tx.wallet_id AND user_id = v_user_id;
      ELSE
        v_new_balance := NULL;
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'status', 'IDEMPOTENT_RETRY',
        'transaction', to_jsonb(v_existing_tx),
        'wallet_id', v_existing_tx.wallet_id,
        'new_balance', v_new_balance
      );
    END IF;
  END IF;

  -- 5. Atomic state modification inside rollback-protected subtransaction block (N02)
  BEGIN
    -- If wallet specified, lock row and update balance INSIDE this block
    IF p_wallet_id IS NOT NULL THEN
      SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet with ID % not found', p_wallet_id;
      END IF;
      IF v_wallet.user_id IS NULL OR v_wallet.user_id <> v_user_id THEN
        RAISE EXCEPTION 'Forbidden: wallet not owned by user';
      END IF;

      IF p_type = 'รายรับ' THEN
        v_delta := p_amount;
      ELSE
        v_delta := -p_amount;
      END IF;

      UPDATE public.wallets
      SET balance = ROUND((balance + v_delta)::NUMERIC, 2),
          updated_at = NOW()
      WHERE id = p_wallet_id
      RETURNING balance INTO v_new_balance;
    END IF;

    -- Insert transaction
    INSERT INTO public.transactions (
      user_id, date, type, category, amount, details, related_job, wallet_id, card_id, job_id, request_id, created_at, updated_at
    ) VALUES (
      v_user_id, p_date, p_type, p_category, ROUND(p_amount, 2), p_details, p_related_job, p_wallet_id, p_card_id, p_job_id, v_req_id, NOW(), NOW()
    )
    RETURNING * INTO v_tx;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'CREATED',
      'transaction', to_jsonb(v_tx),
      'wallet_id', p_wallet_id,
      'new_balance', v_new_balance
    );

  EXCEPTION WHEN unique_violation THEN
    -- Any wallet UPDATE made above within this BEGIN block is automatically rolled back by PostgreSQL! (N02)
    IF v_req_id IS NOT NULL THEN
      SELECT * INTO v_existing_tx 
      FROM public.transactions 
      WHERE user_id = v_user_id AND request_id = v_req_id;

      IF FOUND THEN
        -- Strict null-safe payload comparison across all operation-defining fields (N01)
        IF v_existing_tx.amount IS DISTINCT FROM ROUND(p_amount, 2) OR
           v_existing_tx.type IS DISTINCT FROM p_type OR
           v_existing_tx.date IS DISTINCT FROM p_date OR
           v_existing_tx.category IS DISTINCT FROM p_category OR
           v_existing_tx.details IS DISTINCT FROM p_details OR
           v_existing_tx.wallet_id IS DISTINCT FROM p_wallet_id OR
           v_existing_tx.card_id IS DISTINCT FROM p_card_id OR
           v_existing_tx.job_id IS DISTINCT FROM p_job_id OR
           v_existing_tx.related_job IS DISTINCT FROM p_related_job THEN
          RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: request_id % already used with different payload', v_req_id;
        END IF;

        -- Return balance from recorded operation's wallet, verifying owner (N01)
        IF v_existing_tx.wallet_id IS NOT NULL THEN
          SELECT balance INTO v_new_balance 
          FROM public.wallets 
          WHERE id = v_existing_tx.wallet_id AND user_id = v_user_id;
        ELSE
          v_new_balance := NULL;
        END IF;

        RETURN jsonb_build_object(
          'success', true,
          'status', 'IDEMPOTENT_RETRY',
          'transaction', to_jsonb(v_existing_tx),
          'wallet_id', v_existing_tx.wallet_id,
          'new_balance', v_new_balance
        );
      END IF;
    END IF;
    RAISE;
  END;
END;
$$;

-- Procedure 9: Atomic Transaction Update with Legacy Wallet Resolution (RR02, RR03)
CREATE OR REPLACE FUNCTION public.execute_update_transaction(
  p_tx_id BIGINT,
  p_date DATE,
  p_type TEXT,
  p_category TEXT,
  p_amount NUMERIC,
  p_details TEXT DEFAULT NULL,
  p_related_job TEXT DEFAULT NULL,
  p_wallet_id BIGINT DEFAULT NULL,
  p_card_id BIGINT DEFAULT NULL,
  p_job_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_old_tx RECORD;
  v_old_wallet RECORD;
  v_new_wallet RECORD;
  v_effective_old_wallet_id BIGINT := NULL;
  v_revert_delta NUMERIC := 0;
  v_apply_delta NUMERIC := 0;
  v_old_wallet_balance NUMERIC := NULL;
  v_new_wallet_balance NUMERIC := NULL;
  v_updated_tx RECORD;
  v_job_title TEXT := NULL;
  v_resolved_job RECORD;
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;
  v_user_id := auth.uid();

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount: must be greater than zero';
  END IF;

  SELECT * INTO v_old_tx FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction with ID % not found', p_tx_id;
  END IF;

  IF v_old_tx.user_id IS NULL OR v_old_tx.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Forbidden: transaction not owned by user';
  END IF;

  IF v_old_tx.category = 'ปรับยอดเงิน' OR v_old_tx.transfer_id IS NOT NULL OR v_old_tx.bill_id IS NOT NULL OR v_old_tx.debt_id IS NOT NULL THEN
    RAISE EXCEPTION 'System transaction cannot be modified via general transaction update';
  END IF;

  -- RR03: Validate and resolve job ownership
  IF p_job_id IS NOT NULL THEN
    SELECT title INTO v_job_title FROM public.jobs WHERE id = p_job_id AND user_id = v_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_JOB: Job does not exist or belong to user';
    END IF;
    IF p_related_job IS NULL THEN
      p_related_job := v_job_title;
    END IF;
  ELSIF p_related_job IS NOT NULL AND p_related_job ~ '^[0-9]+$' THEN
    SELECT id, title INTO v_resolved_job FROM public.jobs WHERE id = p_related_job::bigint AND user_id = v_user_id;
    IF FOUND THEN
      p_job_id := v_resolved_job.id;
      p_related_job := v_resolved_job.title;
    END IF;
  ELSIF p_job_id IS NULL AND p_related_job IS NULL THEN
    p_job_id := v_old_tx.job_id;
    p_related_job := v_old_tx.related_job;
  END IF;

  -- RR02: Resolve effective old wallet ID for legacy records
  v_effective_old_wallet_id := v_old_tx.wallet_id;
  IF v_effective_old_wallet_id IS NULL THEN
    v_effective_old_wallet_id := public.resolve_transaction_wallet_id(v_old_tx.details, v_user_id);
  END IF;

  IF v_effective_old_wallet_id IS NOT NULL THEN
    IF v_old_tx.type = 'รายรับ' THEN
      v_revert_delta := -v_old_tx.amount;
    ELSE
      v_revert_delta := v_old_tx.amount;
    END IF;
  END IF;

  IF p_wallet_id IS NOT NULL THEN
    IF p_type = 'รายรับ' THEN
      v_apply_delta := p_amount;
    ELSE
      v_apply_delta := -p_amount;
    END IF;
  END IF;

  -- Case A: Same wallet (note/category only edits leave balance unchanged)
  IF v_effective_old_wallet_id IS NOT NULL AND p_wallet_id IS NOT NULL AND v_effective_old_wallet_id = p_wallet_id THEN
    SELECT * INTO v_old_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
    IF v_old_wallet.user_id IS NULL OR v_old_wallet.user_id <> v_user_id THEN
      RAISE EXCEPTION 'Forbidden: wallet not owned by user';
    END IF;

    IF (v_revert_delta + v_apply_delta) <> 0 THEN
      UPDATE public.wallets
      SET balance = ROUND((balance + (v_revert_delta + v_apply_delta))::NUMERIC, 2),
          updated_at = NOW()
      WHERE id = p_wallet_id
      RETURNING balance INTO v_new_wallet_balance;
    ELSE
      v_new_wallet_balance := v_old_wallet.balance;
    END IF;
    v_old_wallet_balance := v_new_wallet_balance;

  -- Case B: Different wallets
  ELSIF v_effective_old_wallet_id IS NOT NULL AND p_wallet_id IS NOT NULL AND v_effective_old_wallet_id <> p_wallet_id THEN
    IF v_effective_old_wallet_id < p_wallet_id THEN
      SELECT * INTO v_old_wallet FROM public.wallets WHERE id = v_effective_old_wallet_id FOR UPDATE;
      SELECT * INTO v_new_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
    ELSE
      SELECT * INTO v_new_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
      SELECT * INTO v_old_wallet FROM public.wallets WHERE id = v_effective_old_wallet_id FOR UPDATE;
    END IF;

    IF v_old_wallet.user_id IS NULL OR v_old_wallet.user_id <> v_user_id THEN
      RAISE EXCEPTION 'Forbidden: old wallet not owned by user';
    END IF;
    IF v_new_wallet.user_id IS NULL OR v_new_wallet.user_id <> v_user_id THEN
      RAISE EXCEPTION 'Forbidden: new wallet not owned by user';
    END IF;

    IF v_revert_delta <> 0 THEN
      UPDATE public.wallets
      SET balance = ROUND((balance + v_revert_delta)::NUMERIC, 2),
          updated_at = NOW()
      WHERE id = v_effective_old_wallet_id
      RETURNING balance INTO v_old_wallet_balance;
    ELSE
      v_old_wallet_balance := v_old_wallet.balance;
    END IF;

    IF v_apply_delta <> 0 THEN
      UPDATE public.wallets
      SET balance = ROUND((balance + v_apply_delta)::NUMERIC, 2),
          updated_at = NOW()
      WHERE id = p_wallet_id
      RETURNING balance INTO v_new_wallet_balance;
    ELSE
      v_new_wallet_balance := v_new_wallet.balance;
    END IF;

  -- Case C: Old had wallet, new has none
  ELSIF v_effective_old_wallet_id IS NOT NULL AND p_wallet_id IS NULL THEN
    SELECT * INTO v_old_wallet FROM public.wallets WHERE id = v_effective_old_wallet_id FOR UPDATE;
    IF v_old_wallet.user_id IS NULL OR v_old_wallet.user_id <> v_user_id THEN
      RAISE EXCEPTION 'Forbidden: wallet not owned by user';
    END IF;

    IF v_revert_delta <> 0 THEN
      UPDATE public.wallets
      SET balance = ROUND((balance + v_revert_delta)::NUMERIC, 2),
          updated_at = NOW()
      WHERE id = v_effective_old_wallet_id
      RETURNING balance INTO v_old_wallet_balance;
    ELSE
      v_old_wallet_balance := v_old_wallet.balance;
    END IF;

  -- Case D: Old had no wallet, new has wallet
  ELSIF v_effective_old_wallet_id IS NULL AND p_wallet_id IS NOT NULL THEN
    SELECT * INTO v_new_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
    IF v_new_wallet.user_id IS NULL OR v_new_wallet.user_id <> v_user_id THEN
      RAISE EXCEPTION 'Forbidden: wallet not owned by user';
    END IF;

    IF v_apply_delta <> 0 THEN
      UPDATE public.wallets
      SET balance = ROUND((balance + v_apply_delta)::NUMERIC, 2),
          updated_at = NOW()
      WHERE id = p_wallet_id
      RETURNING balance INTO v_new_wallet_balance;
    ELSE
      v_new_wallet_balance := v_new_wallet.balance;
    END IF;
  END IF;

  UPDATE public.transactions
  SET date = p_date,
      type = p_type,
      category = p_category,
      amount = p_amount,
      details = p_details,
      related_job = p_related_job,
      wallet_id = p_wallet_id,
      card_id = p_card_id,
      job_id = p_job_id,
      updated_at = NOW()
  WHERE id = p_tx_id
  RETURNING * INTO v_updated_tx;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'UPDATED',
    'transaction', to_jsonb(v_updated_tx),
    'old_wallet_id', v_effective_old_wallet_id,
    'old_wallet_balance', v_old_wallet_balance,
    'new_wallet_id', p_wallet_id,
    'new_wallet_balance', v_new_wallet_balance
  );
END;
$$;

-- Procedure 10: Atomic Idempotent Transaction Deletion with Balance Reversion (RR02)
CREATE OR REPLACE FUNCTION public.execute_delete_transaction(
  p_tx_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_tx RECORD;
  v_wallet RECORD;
  v_effective_wallet_id BIGINT := NULL;
  v_revert_delta NUMERIC := 0;
  v_new_balance NUMERIC := NULL;
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;
  v_user_id := auth.uid();

  SELECT * INTO v_tx FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'ALREADY_DELETED',
      'message', 'Transaction already deleted or not found'
    );
  END IF;

  IF v_tx.user_id IS NULL OR v_tx.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Forbidden: transaction not owned by user';
  END IF;

  IF v_tx.category = 'ปรับยอดเงิน' THEN
    RAISE EXCEPTION 'รายการนี้เป็นรายการปรับยอดกระทบยอดเงิน หากต้องการแก้ไขยอดเงิน กรุณาใช้ฟังก์ชันกระทบยอดเพื่อปรับยอดใหม่';
  END IF;
  IF v_tx.transfer_id IS NOT NULL THEN
    RAISE EXCEPTION 'รายการนี้เกิดจากการโอนย้ายเงิน กรุณายกเลิกผ่านฟังก์ชันยกเลิกรายการโอน';
  END IF;
  IF v_tx.bill_id IS NOT NULL THEN
    RAISE EXCEPTION 'รายการนี้เชื่อมโยงกับการชำระบิลประจำ กรุณายกเลิกการชำระผ่านแท็บบิลรายเดือน (Bills)';
  END IF;
  IF v_tx.debt_id IS NOT NULL THEN
    RAISE EXCEPTION 'รายการนี้เชื่อมโยงกับการชำระค่างวดหนี้ กรุณาจัดการผ่านแท็บหนี้สิน (Debts)';
  END IF;

  -- RR02: Resolve effective wallet ID for legacy records
  v_effective_wallet_id := v_tx.wallet_id;
  IF v_effective_wallet_id IS NULL THEN
    v_effective_wallet_id := public.resolve_transaction_wallet_id(v_tx.details, v_user_id);
  END IF;

  IF v_effective_wallet_id IS NOT NULL THEN
    SELECT * INTO v_wallet FROM public.wallets WHERE id = v_effective_wallet_id FOR UPDATE;
    IF FOUND AND (v_wallet.user_id = v_user_id) THEN
      IF v_tx.type = 'รายรับ' THEN
        v_revert_delta := -v_tx.amount;
      ELSE
        v_revert_delta := v_tx.amount;
      END IF;

      UPDATE public.wallets
      SET balance = ROUND((balance + v_revert_delta)::NUMERIC, 2),
          updated_at = NOW()
      WHERE id = v_effective_wallet_id
      RETURNING balance INTO v_new_balance;
    END IF;
  END IF;

  DELETE FROM public.transactions WHERE id = p_tx_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'DELETED',
    'deleted_tx_id', p_tx_id,
    'wallet_id', v_effective_wallet_id,
    'revert_delta', v_revert_delta,
    'new_balance', v_new_balance
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. RESTRICT RPC EXECUTE PRIVILEGES TO AUTHENTICATED USERS ONLY (RR06)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  func_sig RECORD;
BEGIN
  FOR func_sig IN
    SELECT proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND proname IN (
        'adjust_wallet_balance',
        'execute_wallet_transfer',
        'cancel_wallet_transfer',
        'cancel_wallet_transfer_by_tx',
        'execute_wallet_reconciliation',
        'execute_bill_payment',
        'cancel_bill_payment',
        'execute_debt_payment',
        'resolve_transaction_wallet_id',
        'execute_create_transaction',
        'execute_update_transaction',
        'execute_delete_transaction'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', func_sig.proname, func_sig.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', func_sig.proname, func_sig.args);
  END LOOP;
END;
$$;

