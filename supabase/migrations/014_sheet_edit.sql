-- Migration: editing from the Google Sheet (2026-11-09), see docs/ARCHITECTURE.md "Правка прямо в Google-таблице"
--   * one sheet-sync run at a time: a lease lock (a crashed run frees it after 2 minutes). Without it two runs
--     (trigger + cron) could both see the "Применить" checkbox and apply the same edits twice, and both try to
--     create a new trip's tab (seen 2026-11-09: "A sheet with the name ... already exists").
--   * the sheet is polled every 10 seconds instead of every minute, so the checkbox is noticed quickly.
-- Edits themselves are applied via bot_apply_proposal (migration 011) with actor 'таблица'.
-- Rollback: supabase/rollback/014_sheet_edit_rollback.sql

BEGIN;

CREATE TABLE sheet_sync_lock (
  id int PRIMARY KEY CHECK (id = 1),
  locked_until timestamptz NOT NULL
);

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

ALTER TABLE sheet_sync_lock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sheet_sync_lock FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION sheet_sync_try_lock(), sheet_sync_release_lock() FROM public, anon, authenticated;

SELECT cron.unschedule('sheet-sync-heal');
SELECT cron.schedule('sheet-sync-poll', '10 seconds', 'SELECT public.notify_sheet_sync()');
-- 8640 runs a day now: keep one day of cron history
SELECT cron.unschedule('cron-history-cleanup');
SELECT cron.schedule('cron-history-cleanup', '17 * * * *', $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '1 day'$$);

COMMIT;
