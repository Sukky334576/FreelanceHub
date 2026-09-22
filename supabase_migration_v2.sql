-- ==============================================================================
-- NATTHAWIT STUDIO: COMPREHENSIVE SUPABASE MIGRATION V2 (REVISED - ROUND 3)
-- ==============================================================================
-- Production-grade, idempotent, reversible, and secure migration.
-- ZERO DATA LOSS: Existing transactions (578+), jobs (126+), bills, categories, etc.
-- remain 100% intact.
--
-- Security: Strict RLS with authenticated user ownership (no unauthenticated access),
-- anon role revoked on all financial/operational data,
-- and atomic SECURITY DEFINER RPCs with authorization, deadlock-safe row locking,
-- and search_path = public.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. BASELINE CORE & SUBSYSTEM TABLES
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.categories (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'รายรับ', 'รายจ่าย'
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
  type TEXT NOT NULL DEFAULT 'bank', -- 'bank', 'cash', 'e-wallet'
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
  debt_type TEXT NOT NULL DEFAULT 'installment', -- 'installment', 'personal_loan', 'auto_loan', 'other'
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
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'paid_off', 'archived'
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
  type TEXT NOT NULL, -- 'รายรับ', 'รายจ่าย', 'โอนเงิน', 'ปรับยอดเงิน'
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
-- 2. SAFE COLUMN ADDITIONS (For Existing Schema Upgrades)
-- ------------------------------------------------------------------------------

DO $$
BEGIN
  -- Ensure user_id on all tables
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

  -- Form fields on jobs
  ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS end_date DATE;
  ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS time_slot TEXT;
  ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS advance_amount NUMERIC(14, 2) DEFAULT 0.00;
  ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS final_amount NUMERIC(14, 2) DEFAULT 0.00;
  ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS profit NUMERIC(14, 2) DEFAULT 0.00;
  ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS description TEXT;
  ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS remark TEXT;

  -- Form fields on bills
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS last_paid_tx_id BIGINT;
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS linked_wallet_id BIGINT;
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS linked_debt_id BIGINT;

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

  -- Bills note/notes compatibility
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS notes TEXT;
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS note TEXT;
  UPDATE public.bills SET notes = note WHERE notes IS NULL AND note IS NOT NULL;
  UPDATE public.bills SET note = notes WHERE note IS NULL AND notes IS NOT NULL;

  -- Transfers note/notes compatibility
  ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS notes TEXT;
  ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS note TEXT;
  UPDATE public.transfers SET notes = note WHERE notes IS NULL AND note IS NOT NULL;
  UPDATE public.transfers SET note = notes WHERE note IS NULL AND notes IS NOT NULL;

  -- Debt payments schema alignment
  ALTER TABLE public.debt_payments ADD COLUMN IF NOT EXISTS total_amount NUMERIC(14, 2);
  ALTER TABLE public.debt_payments ADD COLUMN IF NOT EXISTS principal_amount NUMERIC(14, 2);
  ALTER TABLE public.debt_payments ADD COLUMN IF NOT EXISTS interest_amount NUMERIC(14, 2);
  ALTER TABLE public.debt_payments ADD COLUMN IF NOT EXISTS transaction_id BIGINT;
  UPDATE public.debt_payments SET total_amount = amount WHERE total_amount IS NULL AND amount IS NOT NULL;
  UPDATE public.debt_payments SET principal_amount = principal_paid WHERE principal_amount IS NULL AND principal_paid IS NOT NULL;
  UPDATE public.debt_payments SET interest_amount = interest_paid WHERE interest_amount IS NULL AND interest_paid IS NOT NULL;
END $$;

-- ------------------------------------------------------------------------------
-- 3. SAFE RELATIONAL FOREIGN KEYS WITH ORPHAN HANDLING
-- ------------------------------------------------------------------------------

DO $$
BEGIN
  -- fk_transactions_wallet
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_wallet') THEN
    UPDATE public.transactions SET wallet_id = NULL WHERE wallet_id IS NOT NULL AND wallet_id NOT IN (SELECT id FROM public.wallets);
    ALTER TABLE public.transactions ADD CONSTRAINT fk_transactions_wallet FOREIGN KEY (wallet_id) REFERENCES public.wallets(id) ON DELETE SET NULL;
  END IF;

  -- fk_transactions_job
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_job') THEN
    UPDATE public.transactions SET job_id = NULL WHERE job_id IS NOT NULL AND job_id NOT IN (SELECT id FROM public.jobs);
    ALTER TABLE public.transactions ADD CONSTRAINT fk_transactions_job FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;
  END IF;

  -- fk_transactions_debt
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_debt') THEN
    UPDATE public.transactions SET debt_id = NULL WHERE debt_id IS NOT NULL AND debt_id NOT IN (SELECT id FROM public.debts);
    ALTER TABLE public.transactions ADD CONSTRAINT fk_transactions_debt FOREIGN KEY (debt_id) REFERENCES public.debts(id) ON DELETE SET NULL;
  END IF;

  -- fk_transactions_card
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_card') THEN
    UPDATE public.transactions SET card_id = NULL WHERE card_id IS NOT NULL AND card_id NOT IN (SELECT id FROM public.cards);
    ALTER TABLE public.transactions ADD CONSTRAINT fk_transactions_card FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE SET NULL;
  END IF;

  -- fk_transactions_transfer (Upgrade to ON DELETE SET NULL)
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.conname = 'fk_transactions_transfer' AND t.relname = 'transactions'
  ) THEN
    ALTER TABLE public.transactions DROP CONSTRAINT fk_transactions_transfer;
  END IF;
  UPDATE public.transactions SET transfer_id = NULL WHERE transfer_id IS NOT NULL AND transfer_id NOT IN (SELECT id FROM public.transfers);
  ALTER TABLE public.transactions ADD CONSTRAINT fk_transactions_transfer FOREIGN KEY (transfer_id) REFERENCES public.transfers(id) ON DELETE SET NULL;

  -- fk_transactions_bill
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_bill') THEN
    UPDATE public.transactions SET bill_id = NULL WHERE bill_id IS NOT NULL AND bill_id NOT IN (SELECT id FROM public.bills);
    ALTER TABLE public.transactions ADD CONSTRAINT fk_transactions_bill FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE SET NULL;
  END IF;

  -- fk_bills_wallet
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bills_wallet') THEN
    UPDATE public.bills SET linked_wallet_id = NULL WHERE linked_wallet_id IS NOT NULL AND linked_wallet_id NOT IN (SELECT id FROM public.wallets);
    ALTER TABLE public.bills ADD CONSTRAINT fk_bills_wallet FOREIGN KEY (linked_wallet_id) REFERENCES public.wallets(id) ON DELETE SET NULL;
  END IF;

  -- fk_bills_debt
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bills_debt') THEN
    UPDATE public.bills SET linked_debt_id = NULL WHERE linked_debt_id IS NOT NULL AND linked_debt_id NOT IN (SELECT id FROM public.debts);
    ALTER TABLE public.bills ADD CONSTRAINT fk_bills_debt FOREIGN KEY (linked_debt_id) REFERENCES public.debts(id) ON DELETE SET NULL;
  END IF;

  -- fk_debts_wallet
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_debts_wallet') THEN
    UPDATE public.debts SET default_wallet_id = NULL WHERE default_wallet_id IS NOT NULL AND default_wallet_id NOT IN (SELECT id FROM public.wallets);
    ALTER TABLE public.debts ADD CONSTRAINT fk_debts_wallet FOREIGN KEY (default_wallet_id) REFERENCES public.wallets(id) ON DELETE SET NULL;
  END IF;

  -- fk_debt_payments_debt (Safe non-destructive: NOT VALID prevents failing on legacy orphans without deleting history)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_debt_payments_debt') THEN
    ALTER TABLE public.debt_payments ADD CONSTRAINT fk_debt_payments_debt FOREIGN KEY (debt_id) REFERENCES public.debts(id) ON DELETE CASCADE NOT VALID;
  END IF;

  -- fk_debt_payments_wallet
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_debt_payments_wallet') THEN
    UPDATE public.debt_payments SET wallet_id = NULL WHERE wallet_id IS NOT NULL AND wallet_id NOT IN (SELECT id FROM public.wallets);
    ALTER TABLE public.debt_payments ADD CONSTRAINT fk_debt_payments_wallet FOREIGN KEY (wallet_id) REFERENCES public.wallets(id) ON DELETE SET NULL;
  END IF;

  -- fk_cards_wallet
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cards_wallet') THEN
    UPDATE public.cards SET default_wallet_id = NULL WHERE default_wallet_id IS NOT NULL AND default_wallet_id NOT IN (SELECT id FROM public.wallets);
    ALTER TABLE public.cards ADD CONSTRAINT fk_cards_wallet FOREIGN KEY (default_wallet_id) REFERENCES public.wallets(id) ON DELETE SET NULL;
  END IF;

  -- fk_transfers_from_wallet (Safe non-destructive: NOT VALID without deleting history)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transfers_from_wallet') THEN
    ALTER TABLE public.transfers ADD CONSTRAINT fk_transfers_from_wallet FOREIGN KEY (from_wallet_id) REFERENCES public.wallets(id) ON DELETE RESTRICT NOT VALID;
  END IF;

  -- fk_transfers_to_wallet (Safe non-destructive: NOT VALID without deleting history)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transfers_to_wallet') THEN
    ALTER TABLE public.transfers ADD CONSTRAINT fk_transfers_to_wallet FOREIGN KEY (to_wallet_id) REFERENCES public.wallets(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. DEFAULT INITIAL WALLETS & LEGACY DATA OWNER ASSIGNMENT
-- ------------------------------------------------------------------------------
-- Set v_legacy_owner_id to your production user UUID before running to assign
-- existing rows and seeded wallets to your authenticated user account.
DO $$
DECLARE
  v_legacy_owner_id UUID := NULL; -- Set e.g. '00000000-0000-0000-0000-000000000000'::UUID
BEGIN
  -- 4A. Seed initial default wallets if not present
  INSERT INTO public.wallets (name, type, color, icon, balance, opening_balance, notes, user_id)
  SELECT 'บัญชีสตูดิโอ (ไทยพาณิชย์)', 'bank', '#168EA1', 'fa-building-columns', 0.00, 0.00, 'บัญชีหลักสำหรับรับเงินงานสตูดิโอ', v_legacy_owner_id
  WHERE NOT EXISTS (SELECT 1 FROM public.wallets WHERE name = 'บัญชีสตูดิโอ (ไทยพาณิชย์)');

  INSERT INTO public.wallets (name, type, color, icon, balance, opening_balance, notes, user_id)
  SELECT 'บัญชีส่วนตัว (กสิกรไทย)', 'bank', '#0B9D83', 'fa-building-columns', 0.00, 0.00, 'บัญชีส่วนตัว', v_legacy_owner_id
  WHERE NOT EXISTS (SELECT 1 FROM public.wallets WHERE name = 'บัญชีส่วนตัว (กสิกรไทย)');

  INSERT INTO public.wallets (name, type, color, icon, balance, opening_balance, notes, user_id)
  SELECT 'เงินสดสตูดิโอ', 'cash', '#D97706', 'fa-money-bill-wave', 0.00, 0.00, 'เงินสดหมุนเวียนกองถ่าย', v_legacy_owner_id
  WHERE NOT EXISTS (SELECT 1 FROM public.wallets WHERE name = 'เงินสดสตูดิโอ');

  -- 4B. Assign legacy rows to owner if specified
  IF v_legacy_owner_id IS NOT NULL THEN
    UPDATE public.categories SET user_id = v_legacy_owner_id WHERE user_id IS NULL;
    UPDATE public.jobs SET user_id = v_legacy_owner_id WHERE user_id IS NULL;
    UPDATE public.todos SET user_id = v_legacy_owner_id WHERE user_id IS NULL;
    UPDATE public.bills SET user_id = v_legacy_owner_id WHERE user_id IS NULL;
    UPDATE public.equipment SET user_id = v_legacy_owner_id WHERE user_id IS NULL;
    UPDATE public.wallets SET user_id = v_legacy_owner_id WHERE user_id IS NULL;
    UPDATE public.debts SET user_id = v_legacy_owner_id WHERE user_id IS NULL;
    UPDATE public.debt_payments SET user_id = v_legacy_owner_id WHERE user_id IS NULL;
    UPDATE public.cards SET user_id = v_legacy_owner_id WHERE user_id IS NULL;
    UPDATE public.transfers SET user_id = v_legacy_owner_id WHERE user_id IS NULL;
    UPDATE public.transactions SET user_id = v_legacy_owner_id WHERE user_id IS NULL;
    RAISE NOTICE 'Legacy rows and initial wallets assigned to owner %', v_legacy_owner_id;
  ELSE
    RAISE NOTICE 'NOTICE: v_legacy_owner_id is NULL. Legacy rows and initial wallets have user_id = NULL. Set v_legacy_owner_id to your auth.users UUID to claim ownership.';
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4C. RESOLVE LEGACY TRANSACTION WALLET IDENTITY (RR02)
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
-- 5. PERFORMANCE INDEXES
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_user_request_id ON public.transactions(user_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON public.transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_job_id ON public.transactions(job_id);
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_id ON public.transactions(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_bill_id ON public.transactions(bill_id);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON public.jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_date ON public.jobs(date);
CREATE INDEX IF NOT EXISTS idx_bills_user_id ON public.bills(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON public.wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_debts_user_id ON public.debts(user_id);
CREATE INDEX IF NOT EXISTS idx_debt_payments_debt_id ON public.debt_payments(debt_id);
CREATE INDEX IF NOT EXISTS idx_transfers_user_id ON public.transfers(user_id);

-- ------------------------------------------------------------------------------
-- 6. STRICT ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------

-- Enable RLS on all tables
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;

-- Force RLS on all tables to prevent bypassing policies
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

-- Revoke anon access from all financial and operational tables
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
-- 7. ATOMIC STORED PROCEDURES (RPC) WITH AUTHORIZATION & ROW LOCKING
-- ------------------------------------------------------------------------------

-- Procedure 1: Atomic Balance Adjustment
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

-- Procedure 2: Atomic Transfer Execution with Double-Leg & Transfer ID Linking
CREATE OR REPLACE FUNCTION public.execute_wallet_transfer(
  p_from_id BIGINT,
  p_to_id BIGINT,
  p_amount NUMERIC,
  p_fee NUMERIC,
  p_date DATE,
  p_note TEXT
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
  v_from_owner UUID;
  v_to_owner UUID;
  v_first_id BIGINT;
  v_second_id BIGINT;
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;

  IF p_from_id = p_to_id THEN
    RAISE EXCEPTION 'Source and target wallets cannot be the same';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be greater than zero';
  END IF;

  -- Deadlock-safe row locking in ascending ID order
  IF p_from_id < p_to_id THEN
    v_first_id := p_from_id;
    v_second_id := p_to_id;
  ELSE
    v_first_id := p_to_id;
    v_second_id := p_from_id;
  END IF;

  PERFORM id FROM public.wallets WHERE id = v_first_id FOR UPDATE;
  PERFORM id FROM public.wallets WHERE id = v_second_id FOR UPDATE;

  SELECT user_id, balance, name INTO v_from_owner, v_from_bal, v_from_name FROM public.wallets WHERE id = p_from_id;
  SELECT user_id, balance, name INTO v_to_owner, v_to_bal, v_to_name FROM public.wallets WHERE id = p_to_id;

  IF v_from_owner IS NULL OR v_from_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: source wallet not owned by authenticated user';
  END IF;
  IF v_to_owner IS NULL OR v_to_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: target wallet not owned by authenticated user';
  END IF;

  -- Deduct from source
  UPDATE public.wallets
  SET balance = balance - (p_amount + COALESCE(p_fee, 0)),
      updated_at = NOW()
  WHERE id = p_from_id
  RETURNING balance INTO v_from_bal;

  -- Add to target
  UPDATE public.wallets
  SET balance = balance + p_amount,
      updated_at = NOW()
  WHERE id = p_to_id
  RETURNING balance INTO v_to_bal;

  -- Record transfer master record
  INSERT INTO public.transfers (user_id, from_wallet_id, to_wallet_id, amount, fee, transfer_date, notes)
  VALUES (auth.uid(), p_from_id, p_to_id, p_amount, COALESCE(p_fee, 0), COALESCE(p_date, CURRENT_DATE), p_note)
  RETURNING id INTO v_transfer_id;

  -- Insert double-entry ledger legs
  -- Leg 1: Outflow
  INSERT INTO public.transactions (user_id, date, type, category, amount, details, wallet_id, transfer_id)
  VALUES (
    auth.uid(),
    COALESCE(p_date, CURRENT_DATE),
    'โอนเงิน',
    'โอนเงิน',
    p_amount,
    format('{"scope":"studio","account":"%s","note":"โอนเงินไป %s %s"}', v_from_name, v_to_name, COALESCE(p_note, '')),
    p_from_id,
    v_transfer_id
  );

  -- Leg 2: Inflow
  INSERT INTO public.transactions (user_id, date, type, category, amount, details, wallet_id, transfer_id)
  VALUES (
    auth.uid(),
    COALESCE(p_date, CURRENT_DATE),
    'โอนเงิน',
    'โอนเงิน',
    p_amount,
    format('{"scope":"studio","account":"%s","note":"รับโอนเงินจาก %s %s"}', v_to_name, v_from_name, COALESCE(p_note, '')),
    p_to_id,
    v_transfer_id
  );

  -- Leg 3: Optional fee as Operating Expense
  IF COALESCE(p_fee, 0) > 0 THEN
    INSERT INTO public.transactions (user_id, date, type, category, amount, details, wallet_id, transfer_id)
    VALUES (
      auth.uid(),
      COALESCE(p_date, CURRENT_DATE),
      'รายจ่าย',
      'ค่าธรรมเนียม',
      p_fee,
      format('{"scope":"studio","account":"%s","note":"ค่าธรรมเนียมการโอน"}', v_from_name),
      p_from_id,
      v_transfer_id
    );
  END IF;

  RETURN jsonb_build_object(
    'transfer_id', v_transfer_id,
    'from_wallet_id', p_from_id,
    'from_balance', v_from_bal,
    'to_wallet_id', p_to_id,
    'to_balance', v_to_bal
  );
END;
$$;

-- Procedure 3: Atomic Cancellation of Transfers
CREATE OR REPLACE FUNCTION public.cancel_wallet_transfer(p_transfer_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tr RECORD;
  v_from_bal NUMERIC;
  v_to_bal NUMERIC;
  v_first_id BIGINT;
  v_second_id BIGINT;
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;

  SELECT * INTO v_tr FROM public.transfers WHERE id = p_transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer with ID % not found', p_transfer_id;
  END IF;

  IF v_tr.user_id IS NULL OR v_tr.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: transfer not owned by authenticated user';
  END IF;

  -- Lock wallets in ascending ID order
  IF v_tr.from_wallet_id < v_tr.to_wallet_id THEN
    v_first_id := v_tr.from_wallet_id;
    v_second_id := v_tr.to_wallet_id;
  ELSE
    v_first_id := v_tr.to_wallet_id;
    v_second_id := v_tr.from_wallet_id;
  END IF;

  PERFORM id FROM public.wallets WHERE id = v_first_id FOR UPDATE;
  PERFORM id FROM public.wallets WHERE id = v_second_id FOR UPDATE;

  -- Revert source (+ amount + fee)
  UPDATE public.wallets
  SET balance = balance + (v_tr.amount + COALESCE(v_tr.fee, 0)),
      updated_at = NOW()
  WHERE id = v_tr.from_wallet_id
  RETURNING balance INTO v_from_bal;

  -- Revert target (- amount)
  UPDATE public.wallets
  SET balance = balance - v_tr.amount,
      updated_at = NOW()
  WHERE id = v_tr.to_wallet_id
  RETURNING balance INTO v_to_bal;

  -- Delete all linked transactions
  DELETE FROM public.transactions WHERE transfer_id = p_transfer_id;
  -- Delete transfer record
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

-- Procedure 4: Atomic Reconciliation with Stale State Detection & Custom Date
-- Explicitly drop obsolete 4-arg overload from 991b34f to prevent bypassing strict owner verification
DROP FUNCTION IF EXISTS public.execute_wallet_reconciliation(BIGINT, NUMERIC, NUMERIC, TEXT);

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
  v_wallet RECORD;
  v_diff NUMERIC;
  v_tx_id BIGINT;
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet with ID % not found', p_wallet_id;
  END IF;

  IF v_wallet.user_id IS NULL OR v_wallet.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: wallet not owned by authenticated user';
  END IF;

  -- Stale state protection
  IF p_expected_balance IS NOT NULL AND ABS(v_wallet.balance - p_expected_balance) > 0.01 THEN
    RAISE EXCEPTION 'STALE_BALANCE: ยอดเงินในระบบมีการเปลี่ยนแปลง (ปัจจุบัน: %, คาดหวัง: %) กรุณาตรวจสอบยอดใหม่อีกครั้ง', v_wallet.balance, p_expected_balance;
  END IF;

  v_diff := ROUND((p_actual_balance - v_wallet.balance)::NUMERIC, 2);

  -- Zero diff -> NO_OP
  IF ABS(v_diff) < 0.005 THEN
    RETURN jsonb_build_object(
      'status', 'NO_OP',
      'diff', 0,
      'wallet_id', p_wallet_id,
      'new_balance', v_wallet.balance
    );
  END IF;

  -- Update wallet balance to exact actual balance
  UPDATE public.wallets
  SET balance = p_actual_balance,
      updated_at = NOW()
  WHERE id = p_wallet_id;

  -- Record reconciliation transaction
  INSERT INTO public.transactions (
    user_id, date, type, category, amount, details, wallet_id
  ) VALUES (
    auth.uid(),
    COALESCE(p_date, CURRENT_DATE),
    'ปรับยอดเงิน',
    'ปรับยอดเงิน',
    ABS(v_diff),
    format('{"scope":"studio","account":"%s","note":"ปรับยอดกระทบยอด (%s%s บาท) %s"}',
      v_wallet.name,
      CASE WHEN v_diff > 0 THEN '+' ELSE '' END,
      v_diff,
      COALESCE(p_note, '')
    ),
    p_wallet_id
  )
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'status', 'ADJUSTED',
    'diff', v_diff,
    'tx_id', v_tx_id,
    'wallet_id', p_wallet_id,
    'new_balance', p_actual_balance
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
  v_bill RECORD;
  v_wallet RECORD;
  v_tx_id BIGINT;
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;

  SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill with ID % not found', p_bill_id;
  END IF;

  IF v_bill.user_id IS NULL OR v_bill.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: bill not owned by authenticated user';
  END IF;

  IF v_bill.is_paid THEN
    RAISE EXCEPTION 'Bill is already marked as paid';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet with ID % not found', p_wallet_id;
  END IF;

  IF v_wallet.user_id IS NULL OR v_wallet.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: wallet not owned by authenticated user';
  END IF;

  IF v_wallet.balance < v_bill.amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance (% < %)', v_wallet.balance, v_bill.amount;
  END IF;

  -- 1. Deduct wallet
  UPDATE public.wallets
  SET balance = balance - v_bill.amount,
      updated_at = NOW()
  WHERE id = p_wallet_id;

  -- 2. Create expense transaction
  INSERT INTO public.transactions (
    user_id, date, type, category, amount, details, wallet_id, bill_id
  ) VALUES (
    auth.uid(),
    COALESCE(p_payment_date, CURRENT_DATE),
    'รายจ่าย',
    'ค่าใช้จ่ายคงที่',
    v_bill.amount,
    format('{"scope":"studio","account":"%s","note":"ชำระบิล %s"}', v_wallet.name, v_bill.item),
    p_wallet_id,
    p_bill_id
  ) RETURNING id INTO v_tx_id;

  -- 3. Mark bill paid
  UPDATE public.bills
  SET is_paid = true,
      last_paid_tx_id = v_tx_id,
      updated_at = NOW()
  WHERE id = p_bill_id;

  RETURN jsonb_build_object(
    'status', 'PAID',
    'bill_id', p_bill_id,
    'tx_id', v_tx_id,
    'wallet_id', p_wallet_id,
    'amount', v_bill.amount,
    'new_balance', (v_wallet.balance - v_bill.amount)
  );
END;
$$;

-- Procedure 6: Atomic Cancel Bill Payment
CREATE OR REPLACE FUNCTION public.cancel_bill_payment(p_bill_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill RECORD;
  v_tx RECORD;
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;

  SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill with ID % not found', p_bill_id;
  END IF;

  IF v_bill.user_id IS NULL OR v_bill.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: bill not owned by authenticated user';
  END IF;

  IF NOT v_bill.is_paid THEN
    RAISE EXCEPTION 'Bill is not marked as paid';
  END IF;

  -- Refund wallet if linked transaction exists
  IF v_bill.last_paid_tx_id IS NOT NULL THEN
    SELECT * INTO v_tx FROM public.transactions WHERE id = v_bill.last_paid_tx_id FOR UPDATE;
    IF FOUND AND v_tx.wallet_id IS NOT NULL THEN
      UPDATE public.wallets
      SET balance = balance + v_bill.amount,
          updated_at = NOW()
      WHERE id = v_tx.wallet_id;
    END IF;

    DELETE FROM public.transactions WHERE id = v_bill.last_paid_tx_id;
  END IF;

  UPDATE public.bills
  SET is_paid = false,
      last_paid_tx_id = NULL,
      updated_at = NOW()
  WHERE id = p_bill_id;

  RETURN jsonb_build_object(
    'status', 'CANCELLED',
    'bill_id', p_bill_id,
    'amount_refunded', v_bill.amount
  );
END;
$$;

-- Procedure 7: Atomic Debt Payment with Principal/Interest Ledger Split
CREATE OR REPLACE FUNCTION public.execute_debt_payment(
  p_debt_id BIGINT,
  p_wallet_id BIGINT,
  p_total_amount NUMERIC,
  p_principal_amount NUMERIC,
  p_interest_amount NUMERIC,
  p_payment_date DATE DEFAULT CURRENT_DATE,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debt RECORD;
  v_wallet RECORD;
  v_tx_id BIGINT := NULL;
  v_interest_tx_id BIGINT := NULL;
  v_payment_id BIGINT;
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;

  SELECT * INTO v_debt FROM public.debts WHERE id = p_debt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debt with ID % not found', p_debt_id;
  END IF;

  IF v_debt.user_id IS NULL OR v_debt.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: debt not owned by authenticated user';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet with ID % not found', p_wallet_id;
  END IF;

  IF v_wallet.user_id IS NULL OR v_wallet.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: wallet not owned by authenticated user';
  END IF;

  -- Validate amounts
  IF ABS(p_total_amount - (p_principal_amount + p_interest_amount)) > 0.01 THEN
    RAISE EXCEPTION 'Accounting mismatch: total (%) must equal principal (%) + interest (%)',
      p_total_amount, p_principal_amount, p_interest_amount;
  END IF;

  IF p_principal_amount > v_debt.remaining_principal + 0.01 THEN
    RAISE EXCEPTION 'Principal payment (%) cannot exceed remaining principal (%)',
      p_principal_amount, v_debt.remaining_principal;
  END IF;

  IF v_wallet.balance < p_total_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance (% < %)', v_wallet.balance, p_total_amount;
  END IF;

  -- 1. Deduct wallet
  UPDATE public.wallets
  SET balance = balance - p_total_amount,
      updated_at = NOW()
  WHERE id = p_wallet_id;

  -- 2. Insert split transactions into ledger
  -- Leg A: Principal repayment (Financing Cash Outflow)
  IF COALESCE(p_principal_amount, 0) > 0 THEN
    INSERT INTO public.transactions (
      user_id, date, type, category, amount, details, wallet_id, debt_id
    ) VALUES (
      auth.uid(),
      COALESCE(p_payment_date, CURRENT_DATE),
      'รายจ่าย',
      'ชำระหนี้/ผ่อนสินค้า',
      p_principal_amount,
      format('{"scope":"studio","account":"%s","note":"ชำระหนี้ %s (เงินต้น) %s"}',
        v_wallet.name, v_debt.name, COALESCE(p_note, '')),
      p_wallet_id,
      p_debt_id
    ) RETURNING id INTO v_tx_id;
  END IF;

  -- Leg B: Interest repayment (Studio Operating Expense)
  IF COALESCE(p_interest_amount, 0) > 0 THEN
    INSERT INTO public.transactions (
      user_id, date, type, category, amount, details, wallet_id, debt_id
    ) VALUES (
      auth.uid(),
      COALESCE(p_payment_date, CURRENT_DATE),
      'รายจ่าย',
      'ดอกเบี้ยจ่าย',
      p_interest_amount,
      format('{"scope":"studio","account":"%s","note":"ดอกเบี้ยเงินกู้ %s %s"}',
        v_wallet.name, v_debt.name, COALESCE(p_note, '')),
      p_wallet_id,
      p_debt_id
    ) RETURNING id INTO v_interest_tx_id;

    IF v_tx_id IS NULL THEN
      v_tx_id := v_interest_tx_id;
    END IF;
  END IF;

  -- 3. Record debt_payments history (dual column compatibility)
  INSERT INTO public.debt_payments (
    user_id, debt_id, payment_date, amount, total_amount, principal_paid, principal_amount, interest_paid, interest_amount, wallet_id, transaction_id, note
  ) VALUES (
    auth.uid(),
    p_debt_id,
    COALESCE(p_payment_date, CURRENT_DATE),
    p_total_amount,
    p_total_amount,
    p_principal_amount,
    p_principal_amount,
    p_interest_amount,
    p_interest_amount,
    p_wallet_id,
    v_tx_id,
    p_note
  ) RETURNING id INTO v_payment_id;

  -- 4. Update debt remaining principal and paid months
  UPDATE public.debts
  SET remaining_principal = GREATEST(0, remaining_principal - p_principal_amount),
      paid_months = COALESCE(paid_months, 0) + 1,
      updated_at = NOW()
  WHERE id = p_debt_id;

  RETURN jsonb_build_object(
    'status', 'RECORDED',
    'debt_id', p_debt_id,
    'payment_id', v_payment_id,
    'tx_id', v_tx_id,
    'interest_tx_id', v_interest_tx_id,
    'wallet_id', p_wallet_id,
    'total_amount', p_total_amount,
    'principal_amount', p_principal_amount,
    'interest_amount', p_interest_amount,
    'remaining_principal', GREATEST(0, v_debt.remaining_principal - p_principal_amount),
    'new_wallet_balance', (v_wallet.balance - p_total_amount)
  );
END;
$$;

-- Procedure 8: Atomic Transaction Creation with Idempotency Key (RR05, RR03, N01, N02)
DROP FUNCTION IF EXISTS public.execute_create_transaction(DATE, TEXT, TEXT, NUMERIC, TEXT, BIGINT, BIGINT, BIGINT);
DROP FUNCTION IF EXISTS public.execute_create_transaction(DATE, TEXT, TEXT, NUMERIC, TEXT, TEXT, BIGINT, BIGINT, BIGINT, TEXT);

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
  v_skip_precheck BOOLEAN := FALSE;
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

  -- Check test simulation flag for multi-connection concurrency
  v_skip_precheck := (COALESCE(current_setting('test.simulate_concurrent_race', true), 'false') = 'true');

  -- 4. Fast pre-check for idempotency (RR05, N01)
  IF v_req_id IS NOT NULL AND NOT v_skip_precheck THEN
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

-- Procedure 9: Atomic Transaction Update with Multi-Wallet Rebalance
DROP FUNCTION IF EXISTS public.execute_update_transaction(BIGINT, DATE, TEXT, TEXT, NUMERIC, TEXT, BIGINT, BIGINT, BIGINT);
DROP FUNCTION IF EXISTS public.execute_update_transaction(BIGINT, DATE, TEXT, TEXT, NUMERIC, TEXT, TEXT, BIGINT, BIGINT, BIGINT);

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

  -- Lock and fetch existing transaction
  SELECT * INTO v_old_tx FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction with ID % not found', p_tx_id;
  END IF;

  IF v_old_tx.user_id IS NULL OR v_old_tx.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Forbidden: transaction not owned by user';
  END IF;

  -- Disallow editing locked system transactions directly
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

  -- RR02: Resolve effective old wallet ID (supporting legacy transactions with NULL wallet_id)
  v_effective_old_wallet_id := v_old_tx.wallet_id;
  IF v_effective_old_wallet_id IS NULL THEN
    v_effective_old_wallet_id := public.resolve_transaction_wallet_id(v_old_tx.details, v_user_id);
  END IF;

  -- Calculate revert delta for old wallet
  IF v_effective_old_wallet_id IS NOT NULL THEN
    IF v_old_tx.type = 'รายรับ' THEN
      v_revert_delta := -v_old_tx.amount;
    ELSE
      v_revert_delta := v_old_tx.amount;
    END IF;
  END IF;

  -- Calculate apply delta for new wallet
  IF p_wallet_id IS NOT NULL THEN
    IF p_type = 'รายรับ' THEN
      v_apply_delta := p_amount;
    ELSE
      v_apply_delta := -p_amount;
    END IF;
  END IF;

  -- Case A: Same wallet
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

  -- Update transaction
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

-- Procedure 10: Atomic Idempotent Transaction Deletion with Balance Reversion
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

  -- Lock transaction row
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

  -- Guard special transactions
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

-- Restrict RPC EXECUTE privileges to authenticated users only
REVOKE ALL ON FUNCTION public.adjust_wallet_balance(BIGINT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_wallet_balance(BIGINT, NUMERIC) TO authenticated;

REVOKE ALL ON FUNCTION public.execute_wallet_transfer(BIGINT, BIGINT, NUMERIC, NUMERIC, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_wallet_transfer(BIGINT, BIGINT, NUMERIC, NUMERIC, DATE, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_wallet_transfer(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_wallet_transfer(BIGINT) TO authenticated;

REVOKE ALL ON FUNCTION public.execute_wallet_reconciliation(BIGINT, NUMERIC, NUMERIC, TEXT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_wallet_reconciliation(BIGINT, NUMERIC, NUMERIC, TEXT, DATE) TO authenticated;

REVOKE ALL ON FUNCTION public.execute_bill_payment(BIGINT, BIGINT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_bill_payment(BIGINT, BIGINT, DATE) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_bill_payment(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_bill_payment(BIGINT) TO authenticated;

REVOKE ALL ON FUNCTION public.execute_debt_payment(BIGINT, BIGINT, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_debt_payment(BIGINT, BIGINT, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_transaction_wallet_id(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_transaction_wallet_id(TEXT, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.execute_create_transaction(DATE, TEXT, TEXT, NUMERIC, TEXT, TEXT, BIGINT, BIGINT, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_create_transaction(DATE, TEXT, TEXT, NUMERIC, TEXT, TEXT, BIGINT, BIGINT, BIGINT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.execute_update_transaction(BIGINT, DATE, TEXT, TEXT, NUMERIC, TEXT, TEXT, BIGINT, BIGINT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_update_transaction(BIGINT, DATE, TEXT, TEXT, NUMERIC, TEXT, TEXT, BIGINT, BIGINT, BIGINT) TO authenticated;

REVOKE ALL ON FUNCTION public.execute_delete_transaction(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_delete_transaction(BIGINT) TO authenticated;

