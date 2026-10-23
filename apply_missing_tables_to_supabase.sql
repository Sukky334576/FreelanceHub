-- ==============================================================================
-- FreelanceHub / Natthawit Studio - Safe & Idempotent Schema Upgrade
-- Tables: public.user_profiles & public.recurring_checklist_items
-- Non-destructive, RLS Enforced, Preserves all existing financial data
-- ==============================================================================

-- 1. USER PROFILES TABLE (สำหรับเก็บโปรไฟล์ผู้ใช้งานและสถานะ Onboarding)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  profession TEXT,
  onboarding_completed_at TIMESTAMPTZ,
  onboarding_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS onboarding_payload JSONB;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_profiles' AND policyname = 'user_profiles_owner_all'
  ) THEN
    CREATE POLICY user_profiles_owner_all ON public.user_profiles
      FOR ALL TO authenticated
      USING (id = auth.uid())
      WITH CHECK (id = auth.uid());
  END IF;
END $$;

REVOKE ALL ON TABLE public.user_profiles FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_profiles TO authenticated;

-- Backfill profile อัตโนมัติสำหรับคุณณัฐวิทย์และผู้ใช้เดิมที่มีข้อมูลกระเป๋าเงินอยู่แล้ว
INSERT INTO public.user_profiles (id, display_name, profession, onboarding_completed_at)
SELECT DISTINCT user_id, 'คุณณัฐวิทย์', 'สตูดิโอโปรดักชัน', NOW()
FROM public.wallets
WHERE user_id IS NOT NULL
ON CONFLICT (id) DO UPDATE SET onboarding_completed_at = COALESCE(public.user_profiles.onboarding_completed_at, NOW());

-- RPC สำหรับบันทึก Onboarding อย่างปลอดภัย ป้องกันการสร้างข้อมูลซ้ำ
CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_display_name TEXT,
  p_profession TEXT DEFAULT 'ทั่วไป',
  p_wallet_name TEXT DEFAULT 'บัญชีรับเงินหลัก',
  p_wallet_type TEXT DEFAULT 'bank',
  p_opening_balance NUMERIC DEFAULT 0.00,
  p_opening_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_wallet_id BIGINT;
  v_existing_wallet_count INT;
  v_input_payload JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required';
  END IF;

  v_input_payload := jsonb_build_object(
    'display_name', COALESCE(NULLIF(TRIM(p_display_name), ''), 'ฟรีแลนซ์'),
    'profession', COALESCE(NULLIF(TRIM(p_profession), ''), 'ทั่วไป'),
    'wallet_name', COALESCE(NULLIF(TRIM(p_wallet_name), ''), 'บัญชีรับเงินหลัก'),
    'wallet_type', COALESCE(NULLIF(TRIM(p_wallet_type), ''), 'bank'),
    'opening_balance', ROUND(COALESCE(p_opening_balance, 0.00)::NUMERIC, 2),
    'opening_date', COALESCE(p_opening_date, CURRENT_DATE)
  );

  INSERT INTO public.user_profiles (id, display_name, profession)
  VALUES (v_user_id, COALESCE(NULLIF(TRIM(p_display_name), ''), 'ฟรีแลนซ์'), COALESCE(NULLIF(TRIM(p_profession), ''), 'ทั่วไป'))
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF v_profile.onboarding_completed_at IS NOT NULL THEN
    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE user_id = v_user_id
    ORDER BY id ASC
    LIMIT 1;

    IF v_profile.onboarding_payload IS NOT NULL AND v_profile.onboarding_payload <> v_input_payload THEN
      RETURN jsonb_build_object(
        'success', false,
        'status', 'PAYLOAD_CONFLICT',
        'error', 'ONBOARDING_CONFLICT',
        'message', 'Onboarding has already been completed with different parameters',
        'wallet_id', v_wallet_id,
        'completed_at', v_profile.onboarding_completed_at
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'ALREADY_COMPLETED',
      'message', 'Onboarding has already been completed for this user',
      'wallet_id', v_wallet_id,
      'completed_at', v_profile.onboarding_completed_at
    );
  END IF;

  SELECT COUNT(*) INTO v_existing_wallet_count FROM public.wallets WHERE user_id = v_user_id;

  IF v_existing_wallet_count = 0 THEN
    INSERT INTO public.wallets (
      user_id, name, type, balance, opening_balance, opening_date, color, icon
    )
    VALUES (
      v_user_id,
      COALESCE(NULLIF(TRIM(p_wallet_name), ''), 'บัญชีรับเงินหลัก'),
      COALESCE(NULLIF(TRIM(p_wallet_type), ''), 'bank'),
      ROUND(COALESCE(p_opening_balance, 0.00)::NUMERIC, 2),
      ROUND(COALESCE(p_opening_balance, 0.00)::NUMERIC, 2),
      COALESCE(p_opening_date, CURRENT_DATE),
      '#168EA1',
      'fa-wallet'
    )
    RETURNING id INTO v_wallet_id;
  ELSE
    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_user_id ORDER BY id ASC LIMIT 1;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.categories WHERE user_id = v_user_id) THEN
    INSERT INTO public.categories (user_id, name, type, color, icon)
    VALUES
      (v_user_id, 'รับเงินค่าจ้าง/โปรเจกต์', 'รายรับ', '#10B981', 'fa-money-bill-wave'),
      (v_user_id, 'เงินมัดจำรับล่วงหน้า', 'รายรับ', '#06B6D4', 'fa-hand-holding-dollar'),
      (v_user_id, 'รายรับอื่นๆ', 'รายรับ', '#3B82F6', 'fa-coins'),
      (v_user_id, 'ค่าอุปกรณ์/ซอฟต์แวร์', 'รายจ่าย', '#F43F5E', 'fa-laptop'),
      (v_user_id, 'ค่าเดินทาง/ที่พัก', 'รายจ่าย', '#F97316', 'fa-car'),
      (v_user_id, 'ค่าอาหาร/ของใช้', 'รายจ่าย', '#EAB308', 'fa-utensils'),
      (v_user_id, 'ค่าเช่า/สตูดิโอ', 'รายจ่าย', '#8B5CF6', 'fa-building'),
      (v_user_id, 'สาธารณูปโภค/บิล', 'รายจ่าย', '#64748B', 'fa-receipt'),
      (v_user_id, 'เบ็ดเตล็ด', 'รายจ่าย', '#94A3B8', 'fa-box');
  END IF;

  UPDATE public.user_profiles
  SET display_name = COALESCE(NULLIF(TRIM(p_display_name), ''), display_name, 'ฟรีแลนซ์'),
      profession = COALESCE(NULLIF(TRIM(p_profession), ''), profession, 'ทั่วไป'),
      onboarding_payload = v_input_payload,
      onboarding_completed_at = NOW(),
      updated_at = NOW()
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'COMPLETED',
    'wallet_id', v_wallet_id,
    'completed_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_onboarding(TEXT, TEXT, TEXT, TEXT, NUMERIC, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(TEXT, TEXT, TEXT, TEXT, NUMERIC, DATE) TO authenticated;

-- 2. RECURRING CHECKLIST ITEMS TABLE (สำหรับเช็กลิสต์รายจ่ายประจำ เตือนความจำรายเดือน)
CREATE TABLE IF NOT EXISTS public.recurring_checklist_items (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  due_day INT NOT NULL DEFAULT 1 CHECK (due_day >= 1 AND due_day <= 31),
  note TEXT,
  checked_period VARCHAR(7), -- รูปแบบ: 'YYYY-MM' ในเวลาประเทศไทย
  checked_at TIMESTAMPTZ,
  source_bill_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_recurring_checklist_user_period
  ON public.recurring_checklist_items (user_id, checked_period);

ALTER TABLE public.recurring_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_checklist_items FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'recurring_checklist_items' AND policyname = 'recurring_checklist_items_owner_policy'
  ) THEN
    CREATE POLICY recurring_checklist_items_owner_policy
      ON public.recurring_checklist_items
      FOR ALL
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

REVOKE ALL ON TABLE public.recurring_checklist_items FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recurring_checklist_items TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.recurring_checklist_items_id_seq TO authenticated;

-- คัดลอกบิลที่ไม่ใช่หนี้สินเดิมเข้าสู่เช็กลิสต์รายจ่ายประจำอัตโนมัติ (ไม่ซ้ำซ้อน)
INSERT INTO public.recurring_checklist_items (user_id, title, amount, due_day, note, source_bill_id, checked_period, created_at)
SELECT
  b.user_id,
  COALESCE(NULLIF(TRIM(b.item), ''), 'รายจ่ายประจำ'),
  COALESCE(b.amount, 0.00),
  CASE WHEN b.due_date BETWEEN 1 AND 31 THEN b.due_date ELSE 1 END,
  COALESCE(b.notes, b.note),
  b.id,
  NULL,
  COALESCE(b.created_at, NOW())
FROM public.bills b
WHERE b.user_id IS NOT NULL
  AND b.linked_debt_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.recurring_checklist_items r
    WHERE r.user_id = b.user_id AND r.source_bill_id = b.id
  );

-- RPC สำหรับติ๊กเช็กลิสต์รายจ่ายประจำและรีเซ็ตอัตโนมัติข้ามเดือน
CREATE OR REPLACE FUNCTION public.toggle_recurring_checklist_item(
  p_item_id BIGINT,
  p_expected_period VARCHAR(7),
  p_check BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_item RECORD;
  v_current_period VARCHAR(7);
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;

  v_current_period := to_char(timezone('Asia/Bangkok', NOW()), 'YYYY-MM');

  IF p_expected_period IS NOT NULL AND p_expected_period <> '' AND p_expected_period <> v_current_period THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PERIOD_MISMATCH',
      'current_period', v_current_period,
      'message', 'Month has rolled over, please refresh checklist'
    );
  END IF;

  SELECT * INTO v_item
  FROM public.recurring_checklist_items
  WHERE id = p_item_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ITEM_NOT_FOUND');
  END IF;

  IF p_check THEN
    UPDATE public.recurring_checklist_items
    SET checked_period = v_current_period,
        checked_at = NOW(),
        updated_at = NOW()
    WHERE id = p_item_id AND user_id = v_user_id;
  ELSE
    UPDATE public.recurring_checklist_items
    SET checked_period = NULL,
        checked_at = NULL,
        updated_at = NOW()
    WHERE id = p_item_id AND user_id = v_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'item_id', p_item_id,
    'checked', p_check,
    'checked_period', CASE WHEN p_check THEN v_current_period ELSE NULL END,
    'current_period', v_current_period
  );
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_recurring_checklist_item(BIGINT, VARCHAR, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_recurring_checklist_item(BIGINT, VARCHAR, BOOLEAN) TO authenticated;

-- 3. แจ้ง PostgREST ให้ Reload Schema Cache ทันที
NOTIFY pgrst, 'reload schema';
