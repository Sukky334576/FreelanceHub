-- Run once as postgres after the trial-access migration, only after the app owner
-- confirms their APP LOGIN email. GitHub/Cloudflare identities are not evidence.
-- This file is deliberately outside migrations and outside the public build.
DO $$
DECLARE
  owner_email text := 'REPLACE_WITH_CONFIRMED_OWNER_EMAIL';
  owner_id uuid;
  old_access private.app_access;
BEGIN
  IF owner_email = 'REPLACE_WITH_CONFIRMED_OWNER_EMAIL' THEN
    RAISE EXCEPTION 'Confirm the app owner email before assigning admin access.';
  END IF;
  SELECT id INTO STRICT owner_id FROM auth.users
    WHERE lower(email)=lower(trim(owner_email)) AND email_confirmed_at IS NOT NULL;
  LOCK TABLE private.app_access IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM private.app_access WHERE is_admin AND user_id<>owner_id) THEN
    RAISE EXCEPTION 'An owner is already configured. Review additional admin grants separately.';
  END IF;
  SELECT * INTO STRICT old_access FROM private.app_access WHERE user_id=owner_id FOR UPDATE;
  IF old_access.is_admin THEN RETURN; END IF;
  UPDATE private.app_access SET status='approved',is_admin=true,expires_at=NULL,
    approved_at=coalesce(approved_at,now()),reviewed_by=owner_id,updated_at=clock_timestamp()
    WHERE user_id=owner_id;
  INSERT INTO private.app_access_audit(actor_id,target_id,previous_status,next_status)
    VALUES(owner_id,owner_id,old_access.status,'approved');
END;
$$;
