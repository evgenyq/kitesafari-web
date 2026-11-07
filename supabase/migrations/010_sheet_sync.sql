-- Migration: Google Sheet live view (2026-11-07), see docs/ARCHITECTURE.md
-- Any change to cabins/trips pokes the sheet-sync Edge Function (async via pg_net, one call per statement);
-- pg_cron pokes it every minute too, so the sheet heals after missed calls or manual damage.
-- The shared secret lives in Supabase Vault as 'sheet_sync_secret' (created outside migrations, never in git);
-- without it notify_sheet_sync() is a no-op.
-- Rollback: supabase/rollback/010_sheet_sync_rollback.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE FUNCTION notify_sheet_sync() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  secret text;
BEGIN
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'sheet_sync_secret';
  IF secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://zmbiiywazaytltemzzvc.supabase.co/functions/v1/sheet-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret),
    body := '{}'::jsonb
  );
END;
$$;

CREATE FUNCTION notify_sheet_sync_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_sheet_sync();
  RETURN NULL;
END;
$$;

CREATE TRIGGER sheet_sync_cabins AFTER INSERT OR UPDATE OR DELETE ON cabins
  FOR EACH STATEMENT EXECUTE FUNCTION notify_sheet_sync_trigger();
CREATE TRIGGER sheet_sync_trips AFTER INSERT OR UPDATE ON trips
  FOR EACH STATEMENT EXECUTE FUNCTION notify_sheet_sync_trigger();

REVOKE EXECUTE ON FUNCTION notify_sheet_sync(), notify_sheet_sync_trigger() FROM public, anon, authenticated;

SELECT cron.schedule('sheet-sync-heal', '* * * * *', 'SELECT public.notify_sheet_sync()');
SELECT cron.schedule('cron-history-cleanup', '17 3 * * *', $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '3 days'$$);

COMMIT;
