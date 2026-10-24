-- Follow-up to the production Security Advisor check after trial-access activation.
-- Preserve existing function bodies and data; only narrow their execution context.
BEGIN;
DO $$
BEGIN
  IF to_regprocedure('public.handle_claim_legacy_data()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.handle_claim_legacy_data() FROM PUBLIC, anon, authenticated;
  END IF;
END;
$$;
ALTER FUNCTION public.resolve_transaction_wallet_id(text,uuid) SET search_path = '';
COMMIT;
