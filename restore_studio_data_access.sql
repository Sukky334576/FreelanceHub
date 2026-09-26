-- ==============================================================================
-- RESTORE STUDIO ACCESS & RE-ENABLE DATA FOR NATTHAWIT PRODUCTION
-- ==============================================================================
-- This script restores full read/write access for the Studio Web App (anon key),
-- allowing Khun Natthawit to access and manage all 578+ transactions, 126+ jobs,
-- wallets, bills, and equipment without requiring a login session.
-- ==============================================================================

-- 1. DISABLE ROW LEVEL SECURITY ON OPERATIONAL TABLES
ALTER TABLE public.categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.debts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers DISABLE ROW LEVEL SECURITY;

-- 2. GRANT FULL ACCESS TO BOTH ANON (STUDIO CLIENT) AND AUTHENTICATED
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated;

-- 3. UPDATE STORED PROCEDURES TO SUPPORT STUDIO SINGLE-TENANT (ANON) MODE

-- Procedure 0: Atomic Balance Adjustment
CREATE OR REPLACE FUNCTION public.adjust_wallet_balance(p_wallet_id BIGINT, p_delta NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  SELECT balance INTO v_new_balance
  FROM public.wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet with ID % not found', p_wallet_id;
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
  v_first_id BIGINT;
  v_second_id BIGINT;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be strictly positive';
  END IF;
  IF p_fee < 0 THEN
    RAISE EXCEPTION 'Transfer fee cannot be negative';
  END IF;
  IF p_from_id = p_to_id THEN
    RAISE EXCEPTION 'Source and destination wallets must be different';
  END IF;

  v_first_id := LEAST(p_from_id, p_to_id);
  v_second_id := GREATEST(p_from_id, p_to_id);

  PERFORM 1 FROM public.wallets WHERE id = v_first_id FOR UPDATE;
  PERFORM 1 FROM public.wallets WHERE id = v_second_id FOR UPDATE;

  SELECT name, balance INTO v_from_name, v_from_bal FROM public.wallets WHERE id = p_from_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source wallet not found'; END IF;

  SELECT name, balance INTO v_to_name, v_to_bal FROM public.wallets WHERE id = p_to_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Destination wallet not found'; END IF;

  INSERT INTO public.transfers (from_wallet_id, to_wallet_id, amount, fee, date, note)
  VALUES (p_from_id, p_to_id, p_amount, p_fee, p_date, p_note)
  RETURNING id INTO v_transfer_id;

  INSERT INTO public.transactions (date, type, category, amount, details, wallet_id, transfer_id)
  VALUES (p_date, 'โอนเงิน', 'โอนเงิน', p_amount, COALESCE(p_note, 'โอนเงินไป ' || v_to_name), p_from_id, v_transfer_id)
  RETURNING id INTO v_out_tx_id;

  INSERT INTO public.transactions (date, type, category, amount, details, wallet_id, transfer_id)
  VALUES (p_date, 'โอนเงิน', 'โอนเงิน', p_amount, COALESCE(p_note, 'รับโอนเงินจาก ' || v_from_name), p_to_id, v_transfer_id)
  RETURNING id INTO v_in_tx_id;

  IF p_fee > 0 THEN
    INSERT INTO public.transactions (date, type, category, amount, details, wallet_id, transfer_id)
    VALUES (p_date, 'รายจ่าย', 'ค่าธรรมเนียม', p_fee, 'ค่าธรรมเนียมโอนเงินไป ' || v_to_name, p_from_id, v_transfer_id)
    RETURNING id INTO v_fee_tx_id;
  END IF;

  UPDATE public.wallets SET balance = balance - (p_amount + p_fee), updated_at = NOW()
  WHERE id = p_from_id RETURNING balance INTO v_from_bal;

  UPDATE public.wallets SET balance = balance + p_amount, updated_at = NOW()
  WHERE id = p_to_id RETURNING balance INTO v_to_bal;

  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'from_balance', v_from_bal,
    'to_balance', v_to_bal,
    'outgoing_tx_id', v_out_tx_id,
    'incoming_tx_id', v_in_tx_id,
    'fee_tx_id', v_fee_tx_id
  );
END;
$$;

-- Procedure 2: Cancel Wallet Transfer
CREATE OR REPLACE FUNCTION public.cancel_wallet_transfer(p_transfer_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer RECORD;
  v_from_bal NUMERIC;
  v_to_bal NUMERIC;
  v_first_id BIGINT;
  v_second_id BIGINT;
BEGIN
  SELECT * INTO v_transfer FROM public.transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer with ID % not found', p_transfer_id;
  END IF;

  v_first_id := LEAST(v_transfer.from_wallet_id, v_transfer.to_wallet_id);
  v_second_id := GREATEST(v_transfer.from_wallet_id, v_transfer.to_wallet_id);

  PERFORM 1 FROM public.wallets WHERE id = v_first_id FOR UPDATE;
  PERFORM 1 FROM public.wallets WHERE id = v_second_id FOR UPDATE;

  DELETE FROM public.transactions WHERE transfer_id = p_transfer_id;
  DELETE FROM public.transfers WHERE id = p_transfer_id;

  UPDATE public.wallets SET balance = balance + (v_transfer.amount + v_transfer.fee), updated_at = NOW()
  WHERE id = v_transfer.from_wallet_id RETURNING balance INTO v_from_bal;

  UPDATE public.wallets SET balance = balance - v_transfer.amount, updated_at = NOW()
  WHERE id = v_transfer.to_wallet_id RETURNING balance INTO v_to_bal;

  RETURN jsonb_build_object(
    'success', true,
    'cancelled_transfer_id', p_transfer_id,
    'from_balance', v_from_bal,
    'to_balance', v_to_bal
  );
END;
$$;

-- Procedure 3: Cancel Wallet Transfer by Transaction ID
CREATE OR REPLACE FUNCTION public.cancel_wallet_transfer_by_tx(p_tx_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer_id BIGINT;
BEGIN
  SELECT transfer_id INTO v_transfer_id FROM public.transactions WHERE id = p_tx_id;
  IF v_transfer_id IS NULL THEN
    RAISE EXCEPTION 'Transaction % is not associated with a transfer', p_tx_id;
  END IF;
  RETURN public.cancel_wallet_transfer(v_transfer_id);
END;
$$;

-- Procedure 4: Atomic Wallet Reconciliation
CREATE OR REPLACE FUNCTION public.execute_wallet_reconciliation(
  p_wallet_id BIGINT,
  p_actual_balance NUMERIC,
  p_expected_balance NUMERIC,
  p_reason TEXT DEFAULT 'ปรับยอดเงินจากการตรวจนับจริง',
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_bal NUMERIC;
  v_wallet_name TEXT;
  v_diff NUMERIC;
  v_tx_type TEXT;
  v_tx_id BIGINT;
  v_note TEXT;
BEGIN
  SELECT name, balance INTO v_wallet_name, v_current_bal
  FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet with ID % not found', p_wallet_id;
  END IF;

  IF v_current_bal <> p_expected_balance THEN
    RAISE EXCEPTION 'STALE_BALANCE: expected % but found %', p_expected_balance, v_current_bal;
  END IF;

  v_diff := p_actual_balance - v_current_bal;
  IF v_diff = 0 THEN
    RETURN jsonb_build_object('success', true, 'status', 'NOOP', 'balance', v_current_bal);
  END IF;

  IF v_diff > 0 THEN v_tx_type := 'รายรับ'; ELSE v_tx_type := 'รายจ่าย'; END IF;
  v_note := COALESCE(p_reason, 'ปรับยอดเงิน') || ' (กระทบยอด ' || v_wallet_name || ')';

  INSERT INTO public.transactions (date, type, category, amount, details, wallet_id)
  VALUES (p_date, v_tx_type, 'ปรับยอดเงิน', ABS(v_diff), v_note, p_wallet_id)
  RETURNING id INTO v_tx_id;

  UPDATE public.wallets SET balance = p_actual_balance, updated_at = NOW()
  WHERE id = p_wallet_id;

  RETURN jsonb_build_object('success', true, 'status', 'ADJUSTED', 'tx_id', v_tx_id, 'diff', v_diff, 'new_balance', p_actual_balance);
END;
$$;

-- Procedure 5: Atomic Bill Payment
CREATE OR REPLACE FUNCTION public.execute_bill_payment(
  p_bill_id BIGINT,
  p_wallet_id BIGINT,
  p_paid_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill RECORD;
  v_new_bal NUMERIC;
  v_tx_id BIGINT;
BEGIN
  SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill with ID % not found', p_bill_id; END IF;
  IF v_bill.is_paid THEN RAISE EXCEPTION 'Bill % is already paid', p_bill_id; END IF;

  SELECT balance INTO v_new_bal FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet with ID % not found', p_wallet_id; END IF;

  INSERT INTO public.transactions (date, type, category, amount, details, wallet_id, bill_id)
  VALUES (p_paid_date, 'รายจ่าย', COALESCE(v_bill.category, 'บิลรายเดือน'), v_bill.amount, 'ชำระบิล: ' || v_bill.title, p_wallet_id, p_bill_id)
  RETURNING id INTO v_tx_id;

  UPDATE public.bills SET is_paid = true, paid_date = p_paid_date, transaction_id = v_tx_id, wallet_id = p_wallet_id
  WHERE id = p_bill_id;

  UPDATE public.wallets SET balance = balance - v_bill.amount, updated_at = NOW()
  WHERE id = p_wallet_id RETURNING balance INTO v_new_bal;

  RETURN jsonb_build_object('success', true, 'bill_id', p_bill_id, 'tx_id', v_tx_id, 'new_balance', v_new_bal);
END;
$$;

-- Procedure 6: Cancel Bill Payment
CREATE OR REPLACE FUNCTION public.cancel_bill_payment(p_bill_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill RECORD;
  v_new_bal NUMERIC;
BEGIN
  SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill with ID % not found', p_bill_id; END IF;
  IF NOT v_bill.is_paid THEN RAISE EXCEPTION 'Bill % is not paid', p_bill_id; END IF;

  IF v_bill.wallet_id IS NOT NULL THEN
    PERFORM 1 FROM public.wallets WHERE id = v_bill.wallet_id FOR UPDATE;
    UPDATE public.wallets SET balance = balance + v_bill.amount, updated_at = NOW()
    WHERE id = v_bill.wallet_id RETURNING balance INTO v_new_bal;
  END IF;

  IF v_bill.transaction_id IS NOT NULL THEN
    DELETE FROM public.transactions WHERE id = v_bill.transaction_id;
  END IF;

  UPDATE public.bills SET is_paid = false, paid_date = NULL, transaction_id = NULL, wallet_id = NULL
  WHERE id = p_bill_id;

  RETURN jsonb_build_object('success', true, 'bill_id', p_bill_id, 'new_balance', v_new_bal);
END;
$$;

-- Procedure 7: Atomic Debt Payment
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
  v_new_bal NUMERIC;
  v_new_debt_bal NUMERIC;
  v_payment_id BIGINT;
  v_tx_id BIGINT;
  v_int_tx_id BIGINT;
BEGIN
  SELECT * INTO v_debt FROM public.debts WHERE id = p_debt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Debt with ID % not found', p_debt_id; END IF;

  SELECT balance INTO v_new_bal FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet with ID % not found', p_wallet_id; END IF;

  INSERT INTO public.debt_payments (debt_id, wallet_id, amount, total_amount, principal_paid, principal_amount, interest_paid, interest_amount, payment_date, note)
  VALUES (p_debt_id, p_wallet_id, p_total_amount, p_total_amount, p_principal_amount, p_principal_amount, p_interest_amount, p_interest_amount, p_payment_date, p_note)
  RETURNING id INTO v_payment_id;

  INSERT INTO public.transactions (date, type, category, amount, details, wallet_id, debt_id)
  VALUES (p_payment_date, 'รายจ่าย', 'ชำระหนี้/ผ่อนสินค้า', p_principal_amount, COALESCE(p_note, 'ชำระเงินต้น: ' || v_debt.title), p_wallet_id, p_debt_id)
  RETURNING id INTO v_tx_id;

  IF p_interest_amount > 0 THEN
    INSERT INTO public.transactions (date, type, category, amount, details, wallet_id, debt_id)
    VALUES (p_payment_date, 'รายจ่าย', 'ดอกเบี้ยจ่าย', p_interest_amount, COALESCE(p_note, 'ดอกเบี้ย: ' || v_debt.title), p_wallet_id, p_debt_id)
    RETURNING id INTO v_int_tx_id;
  END IF;

  UPDATE public.debts
  SET remaining_amount = GREATEST(0, remaining_amount - p_principal_amount),
      status = CASE WHEN remaining_amount - p_principal_amount <= 0 THEN 'closed' ELSE status END,
      updated_at = NOW()
  WHERE id = p_debt_id RETURNING remaining_amount INTO v_new_debt_bal;

  UPDATE public.wallets SET balance = balance - p_total_amount, updated_at = NOW()
  WHERE id = p_wallet_id RETURNING balance INTO v_new_bal;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'tx_id', v_tx_id,
    'interest_tx_id', v_int_tx_id,
    'new_wallet_balance', v_new_bal,
    'new_debt_balance', v_new_debt_bal
  );
END;
$$;

-- Procedure 8: Atomic Create General Transaction
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
  v_effective_wallet_id BIGINT;
  v_delta NUMERIC;
  v_new_balance NUMERIC := NULL;
  v_tx_id BIGINT;
  v_tx RECORD;
  v_existing_tx RECORD;
  v_job_title TEXT := NULL;
  v_resolved_job RECORD;
  v_req_id TEXT := NULL;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount: must be greater than zero';
  END IF;

  IF p_request_id IS NOT NULL AND trim(p_request_id) <> '' THEN
    v_req_id := trim(p_request_id);
  END IF;

  IF p_job_id IS NOT NULL THEN
    SELECT title INTO v_job_title FROM public.jobs WHERE id = p_job_id;
  END IF;

  IF p_related_job IS NOT NULL AND trim(p_related_job) <> '' AND p_job_id IS NULL THEN
    SELECT id, title INTO v_resolved_job FROM public.jobs WHERE title = trim(p_related_job) LIMIT 1;
    IF FOUND THEN
      p_job_id := v_resolved_job.id;
      v_job_title := v_resolved_job.title;
    END IF;
  END IF;

  IF v_req_id IS NOT NULL THEN
    SELECT * INTO v_existing_tx FROM public.transactions WHERE request_id = v_req_id;
    IF FOUND THEN
      IF v_existing_tx.date <> p_date OR
         v_existing_tx.type <> p_type OR
         v_existing_tx.category <> p_category OR
         v_existing_tx.amount <> p_amount OR
         COALESCE(v_existing_tx.details, '') <> COALESCE(p_details, '') OR
         COALESCE(v_existing_tx.wallet_id, 0) <> COALESCE(p_wallet_id, 0) OR
         COALESCE(v_existing_tx.card_id, 0) <> COALESCE(p_card_id, 0) OR
         COALESCE(v_existing_tx.job_id, 0) <> COALESCE(p_job_id, 0) OR
         COALESCE(v_existing_tx.related_job, '') <> COALESCE(v_job_title, p_related_job, '') THEN
        RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: request_id % already exists with differing payload', v_req_id;
      END IF;

      IF v_existing_tx.wallet_id IS NOT NULL THEN
        SELECT balance INTO v_new_balance FROM public.wallets WHERE id = v_existing_tx.wallet_id;
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

  v_effective_wallet_id := p_wallet_id;
  IF v_effective_wallet_id IS NULL AND p_details IS NOT NULL THEN
    v_effective_wallet_id := public.resolve_transaction_wallet_id(p_details, NULL);
  END IF;

  IF p_type = 'รายรับ' THEN
    v_delta := p_amount;
  ELSIF p_type = 'รายจ่าย' THEN
    v_delta := -p_amount;
  ELSE
    v_delta := 0;
  END IF;

  IF v_effective_wallet_id IS NOT NULL THEN
    SELECT balance INTO v_new_balance FROM public.wallets WHERE id = v_effective_wallet_id FOR UPDATE;
  END IF;

  BEGIN
    INSERT INTO public.transactions (
      date, type, category, amount, details, related_job, wallet_id, card_id, job_id, request_id
    ) VALUES (
      p_date, p_type, p_category, p_amount, p_details, COALESCE(v_job_title, p_related_job), v_effective_wallet_id, p_card_id, p_job_id, v_req_id
    ) RETURNING * INTO v_tx;
  EXCEPTION WHEN unique_violation THEN
    IF v_req_id IS NOT NULL THEN
      SELECT * INTO v_existing_tx FROM public.transactions WHERE request_id = v_req_id;
      IF FOUND THEN
        IF v_existing_tx.date <> p_date OR
           v_existing_tx.type <> p_type OR
           v_existing_tx.category <> p_category OR
           v_existing_tx.amount <> p_amount OR
           COALESCE(v_existing_tx.details, '') <> COALESCE(p_details, '') OR
           COALESCE(v_existing_tx.wallet_id, 0) <> COALESCE(p_wallet_id, 0) OR
           COALESCE(v_existing_tx.card_id, 0) <> COALESCE(p_card_id, 0) OR
           COALESCE(v_existing_tx.job_id, 0) <> COALESCE(p_job_id, 0) OR
           COALESCE(v_existing_tx.related_job, '') <> COALESCE(v_job_title, p_related_job, '') THEN
          RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: request_id % concurrent collision with differing payload', v_req_id;
        END IF;

        IF v_existing_tx.wallet_id IS NOT NULL THEN
          SELECT balance INTO v_new_balance FROM public.wallets WHERE id = v_existing_tx.wallet_id;
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

  IF v_effective_wallet_id IS NOT NULL AND v_delta <> 0 THEN
    UPDATE public.wallets SET balance = balance + v_delta, updated_at = NOW()
    WHERE id = v_effective_wallet_id RETURNING balance INTO v_new_balance;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'CREATED',
    'transaction', to_jsonb(v_tx),
    'wallet_id', v_effective_wallet_id,
    'new_balance', v_new_balance
  );
END;
$$;

-- Procedure 9: Atomic Update General Transaction
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
  v_old RECORD;
  v_old_eff_wallet BIGINT;
  v_new_eff_wallet BIGINT;
  v_old_delta NUMERIC := 0;
  v_new_delta NUMERIC := 0;
  v_net_delta NUMERIC := 0;
  v_old_bal NUMERIC;
  v_new_bal NUMERIC;
  v_updated_tx RECORD;
  v_job_title TEXT := NULL;
  v_first_id BIGINT;
  v_second_id BIGINT;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Invalid amount: must be greater than zero'; END IF;

  SELECT * INTO v_old FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction with ID % not found', p_tx_id; END IF;

  IF p_job_id IS NOT NULL THEN
    SELECT title INTO v_job_title FROM public.jobs WHERE id = p_job_id;
  END IF;

  v_old_eff_wallet := v_old.wallet_id;
  IF v_old_eff_wallet IS NULL AND v_old.details IS NOT NULL THEN
    v_old_eff_wallet := public.resolve_transaction_wallet_id(v_old.details, NULL);
  END IF;

  v_new_eff_wallet := p_wallet_id;
  IF v_new_eff_wallet IS NULL AND p_details IS NOT NULL THEN
    v_new_eff_wallet := public.resolve_transaction_wallet_id(p_details, NULL);
  END IF;

  IF v_old.type = 'รายรับ' THEN v_old_delta := v_old.amount;
  ELSIF v_old.type = 'รายจ่าย' THEN v_old_delta := -v_old.amount; END IF;

  IF p_type = 'รายรับ' THEN v_new_delta := p_amount;
  ELSIF p_type = 'รายจ่าย' THEN v_new_delta := -p_amount; END IF;

  IF v_old_eff_wallet IS NOT NULL AND v_new_eff_wallet IS NOT NULL AND v_old_eff_wallet <> v_new_eff_wallet THEN
    v_first_id := LEAST(v_old_eff_wallet, v_new_eff_wallet);
    v_second_id := GREATEST(v_old_eff_wallet, v_new_eff_wallet);
    PERFORM 1 FROM public.wallets WHERE id = v_first_id FOR UPDATE;
    PERFORM 1 FROM public.wallets WHERE id = v_second_id FOR UPDATE;

    UPDATE public.wallets SET balance = balance - v_old_delta, updated_at = NOW() WHERE id = v_old_eff_wallet;
    UPDATE public.wallets SET balance = balance + v_new_delta, updated_at = NOW() WHERE id = v_new_eff_wallet RETURNING balance INTO v_new_bal;
  ELSIF v_new_eff_wallet IS NOT NULL THEN
    v_net_delta := v_new_delta - v_old_delta;
    SELECT balance INTO v_new_bal FROM public.wallets WHERE id = v_new_eff_wallet FOR UPDATE;
    IF v_net_delta <> 0 THEN
      UPDATE public.wallets SET balance = balance + v_net_delta, updated_at = NOW() WHERE id = v_new_eff_wallet RETURNING balance INTO v_new_bal;
    END IF;
  ELSIF v_old_eff_wallet IS NOT NULL THEN
    SELECT balance INTO v_old_bal FROM public.wallets WHERE id = v_old_eff_wallet FOR UPDATE;
    UPDATE public.wallets SET balance = balance - v_old_delta, updated_at = NOW() WHERE id = v_old_eff_wallet;
  END IF;

  UPDATE public.transactions SET
    date = p_date,
    type = p_type,
    category = p_category,
    amount = p_amount,
    details = p_details,
    related_job = COALESCE(v_job_title, p_related_job),
    wallet_id = v_new_eff_wallet,
    card_id = p_card_id,
    job_id = p_job_id,
    updated_at = NOW()
  WHERE id = p_tx_id RETURNING * INTO v_updated_tx;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'UPDATED',
    'transaction', to_jsonb(v_updated_tx),
    'wallet_id', v_new_eff_wallet,
    'new_balance', v_new_bal
  );
END;
$$;

-- Procedure 10: Atomic Delete General Transaction
CREATE OR REPLACE FUNCTION public.execute_delete_transaction(p_tx_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old RECORD;
  v_effective_wallet_id BIGINT;
  v_revert_delta NUMERIC := 0;
  v_new_balance NUMERIC := NULL;
BEGIN
  SELECT * INTO v_old FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'status', 'ALREADY_DELETED', 'deleted_tx_id', p_tx_id);
  END IF;

  v_effective_wallet_id := v_old.wallet_id;
  IF v_effective_wallet_id IS NULL AND v_old.details IS NOT NULL THEN
    v_effective_wallet_id := public.resolve_transaction_wallet_id(v_old.details, NULL);
  END IF;

  IF v_old.type = 'รายรับ' THEN v_revert_delta := -v_old.amount;
  ELSIF v_old.type = 'รายจ่าย' THEN v_revert_delta := v_old.amount; END IF;

  IF v_effective_wallet_id IS NOT NULL AND v_revert_delta <> 0 THEN
    SELECT balance INTO v_new_balance FROM public.wallets WHERE id = v_effective_wallet_id FOR UPDATE;
    UPDATE public.wallets SET balance = balance + v_revert_delta, updated_at = NOW()
    WHERE id = v_effective_wallet_id RETURNING balance INTO v_new_balance;
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

-- 4. GRANT EXECUTE ON ALL PROCEDURES TO ANON & AUTHENTICATED
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- 5. RETURN CURRENT ROW COUNTS
SELECT 
  (SELECT count(*) FROM public.transactions) AS total_transactions,
  (SELECT count(*) FROM public.wallets) AS total_wallets,
  (SELECT count(*) FROM public.jobs) AS total_jobs,
  (SELECT count(*) FROM public.bills) AS total_bills,
  (SELECT count(*) FROM public.equipment) AS total_equipment;
