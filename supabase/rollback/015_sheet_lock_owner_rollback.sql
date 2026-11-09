-- Rollback for 015_sheet_lock_owner.sql: back to the 014 lock (no owner) and pg_net's default 5 s timeout.
BEGIN;

DROP FUNCTION IF EXISTS sheet_sync_try_lock(uuid);
DROP FUNCTION IF EXISTS sheet_sync_release_lock(uuid);
ALTER TABLE sheet_sync_lock DROP COLUMN IF EXISTS token;

CREATE FUNCTION sheet_sync_try_lock() RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sheet_sync_lock (id, locked_until) VALUES (1, now() + interval '2 minutes')
  ON CONFLICT (id) DO UPDATE SET locked_until = excluded.locked_until
    WHERE sheet_sync_lock.locked_until < now();
  RETURN FOUND;
END;
$$;
CREATE FUNCTION sheet_sync_release_lock() RETURNS void LANGUAGE sql AS $$
  DELETE FROM sheet_sync_lock WHERE id = 1;
$$;
REVOKE EXECUTE ON FUNCTION sheet_sync_try_lock(), sheet_sync_release_lock() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION notify_sheet_sync() RETURNS void
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

COMMIT;
