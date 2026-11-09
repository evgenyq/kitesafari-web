-- Rollback for 014_sheet_edit.sql: back to one sync a minute, no lock.
BEGIN;

SELECT cron.unschedule('sheet-sync-poll');
SELECT cron.schedule('sheet-sync-heal', '* * * * *', 'SELECT public.notify_sheet_sync()');
SELECT cron.unschedule('cron-history-cleanup');
SELECT cron.schedule('cron-history-cleanup', '17 3 * * *', $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '3 days'$$);
DROP FUNCTION IF EXISTS sheet_sync_try_lock();
DROP FUNCTION IF EXISTS sheet_sync_release_lock();
DROP TABLE IF EXISTS sheet_sync_lock;

COMMIT;
