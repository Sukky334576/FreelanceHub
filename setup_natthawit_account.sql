-- ==============================================================================
-- SETUP NATTHAWIT STUDIO OWNER ACCOUNT & ASSIGN ALL DATA
-- ==============================================================================
-- Run this script in Supabase SQL Editor.
-- It will create the authenticated user for Khun Natthawit (if not already created)
-- and link ALL 578+ transactions, 126+ jobs, wallets, bills, and equipment to it.
-- ==============================================================================

DO $$
DECLARE
  v_user_id UUID := gen_random_uuid();
  v_email TEXT := 'natthawitstudio@gmail.com';
  v_password TEXT := 'StudioNatthawit2026!';
BEGIN
  -- 1. Check if user already exists in auth.users
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
    SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    RAISE NOTICE 'Found existing user % with ID: %', v_email, v_user_id;
  ELSE
    -- Create user in auth.users
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')),
      NOW(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      NOW(),
      NOW(),
      '',
      '',
      '',
      ''
    );

    -- Create user identity in auth.identities
    INSERT INTO auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      v_user_id,
      v_user_id,
      format('{"sub":"%s","email":"%s"}', v_user_id, v_email)::jsonb,
      'email',
      v_user_id,
      NOW(),
      NOW(),
      NOW()
    );
    RAISE NOTICE 'Successfully created new user % with ID: %', v_email, v_user_id;
  END IF;

  -- 2. Link all existing data rows to this user
  UPDATE public.categories SET user_id = v_user_id WHERE user_id IS NULL OR user_id <> v_user_id;
  UPDATE public.jobs SET user_id = v_user_id WHERE user_id IS NULL OR user_id <> v_user_id;
  UPDATE public.todos SET user_id = v_user_id WHERE user_id IS NULL OR user_id <> v_user_id;
  UPDATE public.bills SET user_id = v_user_id WHERE user_id IS NULL OR user_id <> v_user_id;
  UPDATE public.equipment SET user_id = v_user_id WHERE user_id IS NULL OR user_id <> v_user_id;
  UPDATE public.wallets SET user_id = v_user_id WHERE user_id IS NULL OR user_id <> v_user_id;
  UPDATE public.debts SET user_id = v_user_id WHERE user_id IS NULL OR user_id <> v_user_id;
  UPDATE public.debt_payments SET user_id = v_user_id WHERE user_id IS NULL OR user_id <> v_user_id;
  UPDATE public.cards SET user_id = v_user_id WHERE user_id IS NULL OR user_id <> v_user_id;
  UPDATE public.transfers SET user_id = v_user_id WHERE user_id IS NULL OR user_id <> v_user_id;
  UPDATE public.transactions SET user_id = v_user_id WHERE user_id IS NULL OR user_id <> v_user_id;

  -- 3. Backfill wallet_id on legacy transactions
  UPDATE public.transactions t
  SET wallet_id = public.resolve_transaction_wallet_id(t.details, t.user_id)
  WHERE t.wallet_id IS NULL AND t.details IS NOT NULL AND t.user_id = v_user_id;

  RAISE NOTICE 'All 578+ transactions, 126+ jobs, wallets, and bills have been linked to %!', v_email;
END $$;

-- 4. Automatic claim trigger for any future auth users
CREATE OR REPLACE FUNCTION public.handle_claim_legacy_data()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.categories SET user_id = NEW.id WHERE user_id IS NULL;
  UPDATE public.jobs SET user_id = NEW.id WHERE user_id IS NULL;
  UPDATE public.todos SET user_id = NEW.id WHERE user_id IS NULL;
  UPDATE public.bills SET user_id = NEW.id WHERE user_id IS NULL;
  UPDATE public.equipment SET user_id = NEW.id WHERE user_id IS NULL;
  UPDATE public.wallets SET user_id = NEW.id WHERE user_id IS NULL;
  UPDATE public.debts SET user_id = NEW.id WHERE user_id IS NULL;
  UPDATE public.debt_payments SET user_id = NEW.id WHERE user_id IS NULL;
  UPDATE public.cards SET user_id = NEW.id WHERE user_id IS NULL;
  UPDATE public.transfers SET user_id = NEW.id WHERE user_id IS NULL;
  UPDATE public.transactions SET user_id = NEW.id WHERE user_id IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_claim_data ON auth.users;
CREATE TRIGGER on_auth_user_created_claim_data
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_claim_legacy_data();

-- 5. Verification query to confirm all records are active under the user
SELECT 
  (SELECT count(*) FROM auth.users) AS total_users,
  (SELECT email FROM auth.users ORDER BY created_at DESC LIMIT 1) AS user_email,
  (SELECT count(*) FROM public.transactions WHERE user_id IS NOT NULL) AS active_transactions,
  (SELECT count(*) FROM public.wallets WHERE user_id IS NOT NULL) AS active_wallets,
  (SELECT count(*) FROM public.jobs WHERE user_id IS NOT NULL) AS active_jobs,
  (SELECT count(*) FROM public.bills WHERE user_id IS NOT NULL) AS active_bills,
  (SELECT count(*) FROM public.equipment WHERE user_id IS NOT NULL) AS active_equipment;
