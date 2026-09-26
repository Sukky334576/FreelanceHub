-- ==============================================================================
-- SEED WALLETS, LINK TRANSACTIONS & COMPUTE ACCURATE BALANCES
-- ==============================================================================
-- Run this in Supabase SQL Editor.
-- It creates the 3 Studio Wallets, links all 638 transactions to them,
-- and calculates the exact live balance for each wallet.
-- ==============================================================================

DO $$
DECLARE
  v_owner UUID;
  v_studio_wallet_id BIGINT;
BEGIN
  -- 1. Get the owner user ID
  SELECT id INTO v_owner FROM auth.users WHERE email = 'natthawitstudio@gmail.com' LIMIT 1;
  IF v_owner IS NULL THEN 
    SELECT id INTO v_owner FROM auth.users ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'No user found in auth.users!';
  END IF;

  -- 2. Seed the 3 default wallets for Natthawit Studio
  INSERT INTO public.wallets (name, type, color, icon, balance, opening_balance, notes, user_id)
  SELECT 'บัญชีสตูดิโอ (ไทยพาณิชย์)', 'bank', '#168EA1', 'fa-building-columns', 0.00, 0.00, 'บัญชีหลักสำหรับรับเงินงานสตูดิโอ', v_owner
  WHERE NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = v_owner AND name = 'บัญชีสตูดิโอ (ไทยพาณิชย์)');

  INSERT INTO public.wallets (name, type, color, icon, balance, opening_balance, notes, user_id)
  SELECT 'บัญชีส่วนตัว (กสิกรไทย)', 'bank', '#0B9D83', 'fa-building-columns', 0.00, 0.00, 'บัญชีส่วนตัว', v_owner
  WHERE NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = v_owner AND name = 'บัญชีส่วนตัว (กสิกรไทย)');

  INSERT INTO public.wallets (name, type, color, icon, balance, opening_balance, notes, user_id)
  SELECT 'เงินสดสตูดิโอ', 'cash', '#D97706', 'fa-money-bill-wave', 0.00, 0.00, 'เงินสดหมุนเวียนกองถ่าย', v_owner
  WHERE NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = v_owner AND name = 'เงินสดสตูดิโอ');

  -- Get primary studio wallet id
  SELECT id INTO v_studio_wallet_id FROM public.wallets WHERE user_id = v_owner AND name = 'บัญชีสตูดิโอ (ไทยพาณิชย์)' LIMIT 1;

  -- 3. Resolve and link wallet_id on all transactions
  UPDATE public.transactions t
  SET wallet_id = public.resolve_transaction_wallet_id(t.details, t.user_id)
  WHERE t.user_id = v_owner;

  -- Default any remaining unassigned transactions to the primary studio wallet
  UPDATE public.transactions t
  SET wallet_id = v_studio_wallet_id
  WHERE t.user_id = v_owner AND t.wallet_id IS NULL;

  -- 4. Calculate accurate wallet balances from transaction history
  UPDATE public.wallets w
  SET balance = w.opening_balance + COALESCE((
    SELECT SUM(
      CASE 
        WHEN t.type = 'รายรับ' THEN t.amount 
        WHEN t.type = 'รายจ่าย' THEN -t.amount 
        ELSE 0 
      END
    )
    FROM public.transactions t
    WHERE t.wallet_id = w.id
  ), 0),
  updated_at = NOW()
  WHERE w.user_id = v_owner;

  RAISE NOTICE 'Successfully seeded wallets and calculated balances for owner %', v_owner;
END $$;

-- 5. Verification: view created wallets and balances
SELECT 
  id, 
  name, 
  balance, 
  (SELECT count(*) FROM public.transactions WHERE wallet_id = wallets.id) AS transaction_count,
  user_id
FROM public.wallets
ORDER BY id ASC;
