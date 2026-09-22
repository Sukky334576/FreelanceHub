-- ==============================================================================
-- FreelanceHub / Natthawit Studio - Supabase Schema Upgrade Script (FR01 - FR05)
-- Run this script in the Supabase SQL Editor to resolve all Codex findings on live DB
-- ==============================================================================

-- 1. UPGRADE FOREIGN KEY CONSTRAINTS (FR04)
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

-- 2. DROP OBSOLETE OVERLOADS (FR04)
-- Explicitly drop 4-arg execute_wallet_reconciliation overload from commit 991b34f
REVOKE ALL ON FUNCTION public.execute_wallet_reconciliation(BIGINT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.execute_wallet_reconciliation(BIGINT, NUMERIC, NUMERIC, TEXT);

-- 3. ENFORCE ROW LEVEL SECURITY & REVOKE ANON ACCESS (FR05)
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

-- 4. ATOMIC GENERAL TRANSACTION RPCS (FR01)
-- Procedure 8: Atomic Transaction Creation with Wallet Balance Sync
CREATE OR REPLACE FUNCTION public.execute_create_transaction(
  p_date DATE,
  p_type TEXT,
  p_category TEXT,
  p_amount NUMERIC,
  p_details TEXT DEFAULT NULL,
  p_related_job BIGINT DEFAULT NULL,
  p_wallet_id BIGINT DEFAULT NULL,
  p_card_id BIGINT DEFAULT NULL
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
BEGIN
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;
  v_user_id := auth.uid();

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount: must be greater than zero';
  END IF;

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

  INSERT INTO public.transactions (
    user_id, date, type, category, amount, details, related_job, wallet_id, card_id, created_at, updated_at
  ) VALUES (
    v_user_id, p_date, p_type, p_category, p_amount, p_details, p_related_job, p_wallet_id, p_card_id, NOW(), NOW()
  )
  RETURNING * INTO v_tx;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'CREATED',
    'transaction', to_jsonb(v_tx),
    'wallet_id', p_wallet_id,
    'new_balance', v_new_balance
  );
END;
$$;

-- Procedure 9: Atomic Transaction Update with Multi-Wallet Rebalance
CREATE OR REPLACE FUNCTION public.execute_update_transaction(
  p_tx_id BIGINT,
  p_date DATE,
  p_type TEXT,
  p_category TEXT,
  p_amount NUMERIC,
  p_details TEXT DEFAULT NULL,
  p_related_job BIGINT DEFAULT NULL,
  p_wallet_id BIGINT DEFAULT NULL,
  p_card_id BIGINT DEFAULT NULL
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
  v_revert_delta NUMERIC := 0;
  v_apply_delta NUMERIC := 0;
  v_old_wallet_balance NUMERIC := NULL;
  v_new_wallet_balance NUMERIC := NULL;
  v_updated_tx RECORD;
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

  -- Calculate revert delta for old wallet
  IF v_old_tx.wallet_id IS NOT NULL THEN
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
  IF v_old_tx.wallet_id IS NOT NULL AND p_wallet_id IS NOT NULL AND v_old_tx.wallet_id = p_wallet_id THEN
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
  ELSIF v_old_tx.wallet_id IS NOT NULL AND p_wallet_id IS NOT NULL AND v_old_tx.wallet_id <> p_wallet_id THEN
    -- Lock in consistent order to prevent deadlocks
    IF v_old_tx.wallet_id < p_wallet_id THEN
      SELECT * INTO v_old_wallet FROM public.wallets WHERE id = v_old_tx.wallet_id FOR UPDATE;
      SELECT * INTO v_new_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
    ELSE
      SELECT * INTO v_new_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
      SELECT * INTO v_old_wallet FROM public.wallets WHERE id = v_old_tx.wallet_id FOR UPDATE;
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
      WHERE id = v_old_tx.wallet_id
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
  ELSIF v_old_tx.wallet_id IS NOT NULL AND p_wallet_id IS NULL THEN
    SELECT * INTO v_old_wallet FROM public.wallets WHERE id = v_old_tx.wallet_id FOR UPDATE;
    IF v_old_wallet.user_id IS NULL OR v_old_wallet.user_id <> v_user_id THEN
      RAISE EXCEPTION 'Forbidden: wallet not owned by user';
    END IF;

    IF v_revert_delta <> 0 THEN
      UPDATE public.wallets
      SET balance = ROUND((balance + v_revert_delta)::NUMERIC, 2),
          updated_at = NOW()
      WHERE id = v_old_tx.wallet_id
      RETURNING balance INTO v_old_wallet_balance;
    ELSE
      v_old_wallet_balance := v_old_wallet.balance;
    END IF;

  -- Case D: Old had no wallet, new has wallet
  ELSIF v_old_tx.wallet_id IS NULL AND p_wallet_id IS NOT NULL THEN
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
      updated_at = NOW()
  WHERE id = p_tx_id
  RETURNING * INTO v_updated_tx;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'UPDATED',
    'transaction', to_jsonb(v_updated_tx),
    'old_wallet_id', v_old_tx.wallet_id,
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
    -- Idempotent return: already deleted or not found
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

  -- Revert wallet balance if wallet_id is set
  IF v_tx.wallet_id IS NOT NULL THEN
    SELECT * INTO v_wallet FROM public.wallets WHERE id = v_tx.wallet_id FOR UPDATE;
    IF FOUND AND (v_wallet.user_id = v_user_id) THEN
      IF v_tx.type = 'รายรับ' THEN
        v_revert_delta := -v_tx.amount;
      ELSE
        v_revert_delta := v_tx.amount;
      END IF;

      UPDATE public.wallets
      SET balance = ROUND((balance + v_revert_delta)::NUMERIC, 2),
          updated_at = NOW()
      WHERE id = v_tx.wallet_id
      RETURNING balance INTO v_new_balance;
    END IF;
  END IF;

  DELETE FROM public.transactions WHERE id = p_tx_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'DELETED',
    'deleted_tx_id', p_tx_id,
    'wallet_id', v_tx.wallet_id,
    'revert_delta', v_revert_delta,
    'new_balance', v_new_balance
  );
END;
$$;

-- 5. RPC PRIVILEGES
REVOKE ALL ON FUNCTION public.execute_create_transaction(DATE, TEXT, TEXT, NUMERIC, TEXT, BIGINT, BIGINT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_create_transaction(DATE, TEXT, TEXT, NUMERIC, TEXT, BIGINT, BIGINT, BIGINT) TO authenticated;

REVOKE ALL ON FUNCTION public.execute_update_transaction(BIGINT, DATE, TEXT, TEXT, NUMERIC, TEXT, BIGINT, BIGINT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_update_transaction(BIGINT, DATE, TEXT, TEXT, NUMERIC, TEXT, BIGINT, BIGINT, BIGINT) TO authenticated;

REVOKE ALL ON FUNCTION public.execute_delete_transaction(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_delete_transaction(BIGINT) TO authenticated;
