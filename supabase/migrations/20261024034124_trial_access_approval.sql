-- Trial access is server-authoritative. Apply after the baseline schema.
-- Bootstrap the explicitly selected owner separately; never trust signup metadata for roles.
BEGIN;
-- Keep signups out of the backfill/trigger replacement window.
LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE TABLE IF NOT EXISTS private.app_access (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')),
  is_admin boolean NOT NULL DEFAULT false,
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  expires_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS app_access_review_queue ON private.app_access(status, created_at, user_id);
ALTER TABLE private.app_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.app_access FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS private.app_access_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_status text NOT NULL,
  next_status text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.app_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.app_access_audit FROM PUBLIC, anon, authenticated;

-- Existing accounts keep their existing access. Re-runs never approve pending applicants.
INSERT INTO private.app_access(user_id,status,display_name,approved_at)
SELECT id,'approved',left(coalesce(raw_user_meta_data->>'display_name',''),100),now() FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- The legacy trigger handed every unowned financial row to the next person signing up.
-- Public signup must never claim another person's historical records.
DROP TRIGGER IF EXISTS on_auth_user_created_claim_data ON auth.users;
CREATE OR REPLACE FUNCTION private.register_trial_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO private.app_access(user_id,display_name)
  VALUES (NEW.id,left(coalesce(NEW.raw_user_meta_data->>'display_name',''),100))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.register_trial_request() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_auth_user_created_trial_request ON auth.users;
CREATE TRIGGER on_auth_user_created_trial_request AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.register_trial_request();

CREATE OR REPLACE FUNCTION private.app_access_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM private.app_access a WHERE a.user_id=auth.uid() AND a.status='approved'
    AND (a.expires_at IS NULL OR a.expires_at>now())
  );
$$;
CREATE OR REPLACE FUNCTION private.require_app_access() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.app_access_allowed() THEN
    RAISE EXCEPTION 'ACCESS_NOT_APPROVED' USING ERRCODE='42501';
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION private.require_access_admin() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_app_access();
  IF NOT EXISTS (SELECT 1 FROM private.app_access WHERE user_id=auth.uid() AND is_admin) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE='42501';
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION private.my_app_access() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a private.app_access;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM private.app_access WHERE user_id=auth.uid();
  RETURN jsonb_build_object('user_id',auth.uid(),'status',coalesce(a.status,'pending'),
    'is_admin',coalesce(a.is_admin,false),'allowed',private.app_access_allowed(),
    'expires_at',a.expires_at,'display_name',coalesce(a.display_name,''));
END;
$$;
CREATE OR REPLACE FUNCTION private.list_trial_requests(p_status text, p_offset integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM private.require_access_admin();
  IF p_status IS NULL OR p_status NOT IN ('all','pending','approved','rejected','suspended') OR p_offset IS NULL OR p_offset<0 THEN
    RAISE EXCEPTION 'INVALID_FILTER';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) INTO result FROM (
    SELECT a.*,u.email,(u.email_confirmed_at IS NOT NULL) AS email_confirmed
    FROM private.app_access a JOIN auth.users u ON u.id=a.user_id
    WHERE p_status='all' OR a.status=p_status
    ORDER BY a.created_at DESC,a.user_id LIMIT 50 OFFSET p_offset
  ) q;
  RETURN jsonb_build_object('items',result,'total',(SELECT count(*) FROM private.app_access WHERE p_status='all' OR status=p_status));
END;
$$;
CREATE OR REPLACE FUNCTION private.review_trial_request(p_user_id uuid,p_status text,p_expected_updated_at timestamptz,p_trial_days integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a private.app_access; new_expiry timestamptz;
BEGIN
  PERFORM private.require_access_admin();
  IF p_status IS NULL OR p_status NOT IN ('approved','rejected','suspended') OR (p_trial_days IS NOT NULL AND (p_trial_days<1 OR p_trial_days>365)) THEN
    RAISE EXCEPTION 'INVALID_DECISION';
  END IF;
  SELECT * INTO a FROM private.app_access WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF a.is_admin OR a.user_id=auth.uid() THEN RAISE EXCEPTION 'ADMIN_ACCOUNT_PROTECTED' USING ERRCODE='42501'; END IF;
  IF a.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'STALE_REVIEW'; END IF;
  new_expiry := CASE WHEN p_status='approved' AND p_trial_days IS NOT NULL THEN now()+make_interval(days=>p_trial_days) ELSE NULL END;
  UPDATE private.app_access SET status=p_status,expires_at=new_expiry,
    approved_at=CASE WHEN p_status='approved' THEN now() ELSE approved_at END,
    reviewed_by=auth.uid(),updated_at=clock_timestamp() WHERE user_id=p_user_id;
  INSERT INTO private.app_access_audit(actor_id,target_id,previous_status,next_status,expires_at)
    VALUES(auth.uid(),p_user_id,a.status,p_status,new_expiry);
  RETURN jsonb_build_object('user_id',p_user_id,'status',p_status,'expires_at',new_expiry);
END;
$$;

-- Only these invoker wrappers are exposed through PostgREST.
CREATE OR REPLACE FUNCTION public.get_my_app_access() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.my_app_access(); $$;
CREATE OR REPLACE FUNCTION public.list_trial_requests(p_status text DEFAULT 'pending',p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.list_trial_requests(p_status,p_offset); $$;
CREATE OR REPLACE FUNCTION public.review_trial_request(p_user_id uuid,p_status text,p_expected_updated_at timestamptz,p_trial_days integer DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.review_trial_request(p_user_id,p_status,p_expected_updated_at,p_trial_days); $$;

REVOKE ALL ON FUNCTION private.app_access_allowed(),private.require_app_access(),private.require_access_admin(),private.my_app_access(),private.list_trial_requests(text,integer),private.review_trial_request(uuid,text,timestamptz,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.app_access_allowed(),private.require_app_access(),private.my_app_access(),private.list_trial_requests(text,integer),private.review_trial_request(uuid,text,timestamptz,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_app_access(),public.list_trial_requests(text,integer),public.review_trial_request(uuid,text,timestamptz,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_app_access(),public.list_trial_requests(text,integer),public.review_trial_request(uuid,text,timestamptz,integer) TO authenticated;

-- A restrictive policy composes with the existing owner policies; no cross-user grants.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories','jobs','todos','bills','equipment','wallets','debts','debt_payments','cards','transfers','transactions','user_profiles','recurring_checklist_items'] LOOP
    IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'Missing baseline table %',t; END IF;
    EXECUTE format('DROP POLICY IF EXISTS trial_access_required ON public.%I',t);
    EXECUTE format('CREATE POLICY trial_access_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT private.app_access_allowed())) WITH CHECK ((SELECT private.app_access_allowed()))',t);
  END LOOP;
END;
$$;

-- Existing SECURITY DEFINER financial RPCs bypass RLS, so guard their entry points too.
-- Work from deployed definitions to preserve reconciliations and any compatible hotfixes.
DO $$
DECLARE r record; definition text; expected text; found_count integer;
BEGIN
  FOREACH expected IN ARRAY ARRAY['adjust_wallet_balance','execute_wallet_transfer','cancel_wallet_transfer','cancel_wallet_transfer_by_tx','execute_wallet_reconciliation','execute_bill_payment','cancel_bill_payment','execute_debt_payment','execute_create_transaction','execute_update_transaction','execute_delete_transaction','complete_onboarding','toggle_recurring_checklist_item'] LOOP
    found_count:=0;
    FOR r IN SELECT p.oid,p.prosrc,l.lanname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' AND p.proname=expected LOOP
      found_count:=found_count+1;
      IF r.lanname<>'plpgsql' THEN RAISE EXCEPTION 'Unsupported RPC language: %',expected; END IF;
      IF position('PERFORM private.require_app_access();' IN r.prosrc)=0 THEN
        definition:=pg_get_functiondef(r.oid);
        IF definition !~* E'\\mBEGIN\\M' THEN RAISE EXCEPTION 'Missing RPC body: %',expected; END IF;
        EXECUTE regexp_replace(definition,E'\\mBEGIN\\M',E'BEGIN\n  PERFORM private.require_app_access();','i');
      END IF;
    END LOOP;
    IF found_count=0 THEN RAISE EXCEPTION 'Missing financial RPC: %',expected; END IF;
  END LOOP;
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
