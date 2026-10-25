-- Regression fixture: deployed RPC read from the SQL Editor on 2026-10-25.
-- Whitespace was normalized by the UI; the faulty date reference is intentional.
-- Test-only: do not deploy this definition.
CREATE OR REPLACE FUNCTION public.execute_wallet_transfer(p_from_id bigint, p_to_id bigint, p_amount numeric, p_fee numeric DEFAULT 0.00, p_date date DEFAULT CURRENT_DATE, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
 PERFORM private.require_app_access();
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
$function$
