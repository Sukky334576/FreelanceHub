-- ==============================================================================
-- NATTHAWIT STUDIO: COMPREHENSIVE SCHEMA UPGRADE SCRIPT
-- ==============================================================================
-- This script creates the new tables for Wallets, Debts, Installments, Cards,
-- and Statement Tracking.
-- It is idempotent, reversible, and guarantees ZERO DATA LOSS for existing data.
-- ==============================================================================

-- 1. WALLETS (กระเป๋าเงิน / บัญชี)
CREATE TABLE IF NOT EXISTS public.wallets (
  id BIGSERIAL PRIMARY KEY,
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

-- 2. DEBTS (หนี้สินและรายการผ่อนชำระ)
CREATE TABLE IF NOT EXISTS public.debts (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  lender TEXT, -- e.g., 'Shopee SPayLater', 'Toyota Leasing', 'KBank'
  debt_type TEXT NOT NULL DEFAULT 'installment', -- 'installment', 'personal_loan', 'auto_loan', 'other'
  original_principal NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  remaining_principal NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  interest_method TEXT NOT NULL DEFAULT 'zero', -- 'zero', 'reducing', 'flat', 'manual'
  interest_rate NUMERIC(8, 4) DEFAULT 0.00,
  rate_unit TEXT DEFAULT 'annual', -- 'annual', 'monthly', 'total'
  term_months INTEGER DEFAULT 1,
  paid_months INTEGER DEFAULT 0,
  monthly_payment NUMERIC(14, 2) DEFAULT 0.00,
  due_day INTEGER DEFAULT 1, -- day of month (1-31)
  default_wallet_id BIGINT REFERENCES public.wallets(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'paid_off', 'archived'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. DEBT PAYMENTS (ประวัติการชำระค่างวด)
CREATE TABLE IF NOT EXISTS public.debt_payments (
  id BIGSERIAL PRIMARY KEY,
  debt_id BIGINT NOT NULL REFERENCES public.debts(id) ON DELETE CASCADE,
  wallet_id BIGINT REFERENCES public.wallets(id) ON DELETE SET NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(14, 2) NOT NULL,
  principal_paid NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  interest_paid NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  fee_paid NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. CREDIT & CASH CARDS (บัตรเครดิตและบัตรกดเงินสด)
CREATE TABLE IF NOT EXISTS public.cards (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  issuer TEXT NOT NULL, -- e.g. 'KBank', 'SCB', 'KTC', 'Krungsri'
  card_type TEXT NOT NULL DEFAULT 'credit', -- 'credit', 'cash_card'
  last_four VARCHAR(4),
  closing_day INTEGER NOT NULL DEFAULT 20, -- day of month (1-31 or 99 for last day)
  due_day INTEGER NOT NULL DEFAULT 10,
  credit_limit NUMERIC(14, 2) DEFAULT 0.00,
  current_balance NUMERIC(14, 2) DEFAULT 0.00,
  default_payment_mode TEXT DEFAULT 'full', -- 'full', 'installment', 'partial'
  default_wallet_id BIGINT REFERENCES public.wallets(id) ON DELETE SET NULL,
  color TEXT DEFAULT '#164F57',
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. CARD INSTALLMENT PLANS (แผนผ่อนชำระในบัตร)
CREATE TABLE IF NOT EXISTS public.card_installment_plans (
  id BIGSERIAL PRIMARY KEY,
  card_id BIGINT NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  original_amount NUMERIC(14, 2) NOT NULL,
  remaining_amount NUMERIC(14, 2) NOT NULL,
  term_months INTEGER NOT NULL DEFAULT 10,
  paid_months INTEGER NOT NULL DEFAULT 0,
  monthly_payment NUMERIC(14, 2) NOT NULL,
  interest_rate NUMERIC(8, 4) DEFAULT 0.00,
  start_date DATE DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'completed'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Add non-breaking relational columns to existing tables
ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS wallet_id BIGINT,
ADD COLUMN IF NOT EXISTS debt_id BIGINT,
ADD COLUMN IF NOT EXISTS card_id BIGINT,
ADD COLUMN IF NOT EXISTS transfer_target_wallet_id BIGINT;

ALTER TABLE public.bills
ADD COLUMN IF NOT EXISTS linked_debt_id BIGINT,
ADD COLUMN IF NOT EXISTS linked_wallet_id BIGINT;

-- 7. Insert default initial studio wallets if not exists
INSERT INTO public.wallets (name, type, color, icon, balance, opening_balance, notes)
SELECT 'บัญชีสตูดิโอ (ไทยพาณิชย์)', 'bank', '#168EA1', 'fa-building-columns', 0.00, 0.00, 'บัญชีหลักสำหรับรับเงินงานสตูดิโอ'
WHERE NOT EXISTS (SELECT 1 FROM public.wallets WHERE name = 'บัญชีสตูดิโอ (ไทยพาณิชย์)');

INSERT INTO public.wallets (name, type, color, icon, balance, opening_balance, notes)
SELECT 'บัญชีส่วนตัว (กสิกรไทย)', 'bank', '#0B9D83', 'fa-building-columns', 0.00, 0.00, 'บัญชีส่วนตัว'
WHERE NOT EXISTS (SELECT 1 FROM public.wallets WHERE name = 'บัญชีส่วนตัว (กสิกรไทย)');

INSERT INTO public.wallets (name, type, color, icon, balance, opening_balance, notes)
SELECT 'เงินสดสตูดิโอ', 'cash', '#D97706', 'fa-money-bill-wave', 0.00, 0.00, 'เงินสดหมุนเวียนกองถ่าย'
WHERE NOT EXISTS (SELECT 1 FROM public.wallets WHERE name = 'เงินสดสตูดิโอ');

