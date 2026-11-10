-- Due follow-ups (see docs/ARCHITECTURE.md, "Люди и запросы").
-- Every 15 minutes the database checks whether anything is due: an open request whose follow_up_at has come,
-- or an open notebook item whose remind_at has come, not yet sent. Only then it pokes telegram-webhook, which
-- sends each item once with buttons. Nothing due — no call, no message. Same Vault secret as sheet-sync
-- ('sheet_sync_secret'); without it this is a no-op.
-- Rollback: supabase/rollback/019_follow_ups_rollback.sql

BEGIN;

CREATE FUNCTION notify_follow_ups() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM requests WHERE closed_at IS NULL AND follow_up_sent_at IS NULL AND follow_up_at <= now())
     AND NOT EXISTS (SELECT 1 FROM notes WHERE status = 'open' AND reminded_at IS NULL AND remind_at <= now()) THEN
    RETURN;
  END IF;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'sheet_sync_secret';
  IF secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://zmbiiywazaytltemzzvc.supabase.co/functions/v1/telegram-webhook',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION notify_follow_ups() FROM public, anon, authenticated;

SELECT cron.schedule('follow-ups', '*/15 * * * *', 'SELECT public.notify_follow_ups()');

COMMIT;
