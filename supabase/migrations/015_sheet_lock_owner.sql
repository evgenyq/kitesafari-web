-- Migration: sheet-sync lock with an owner (2026-11-09), after review of 014.
--   * A run that outlived its lease could delete the lock a newer run had taken, letting a third run start
--     alongside. Now the lock carries the run's token and only its owner releases it. Lease 3 min > edge wall clock.
--   * pg_net gave up on the function after 5 s (default); a slow run (apply + writes) must not be cut off.
-- Rollback: supabase/rollback/015_sheet_lock_owner_rollback.sql

BEGIN;

DROP FUNCTION sheet_sync_try_lock();
DROP FUNCTION sheet_sync_release_lock();
ALTER TABLE sheet_sync_lock ADD COLUMN token uuid;

CREATE FUNCTION sheet_sync_try_lock(p_token uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sheet_sync_lock (id, locked_until, token) VALUES (1, now() + interval '3 minutes', p_token)
  ON CONFLICT (id) DO UPDATE SET locked_until = excluded.locked_until, token = excluded.token
    WHERE sheet_sync_lock.locked_until < now();
  RETURN FOUND;
END;
$$;

CREATE FUNCTION sheet_sync_release_lock(p_token uuid) RETURNS void LANGUAGE sql AS $$
  DELETE FROM sheet_sync_lock WHERE id = 1 AND token = p_token;
$$;

REVOKE EXECUTE ON FUNCTION sheet_sync_try_lock(uuid), sheet_sync_release_lock(uuid) FROM public, anon, authenticated;

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
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
END;
$$;

COMMIT;
