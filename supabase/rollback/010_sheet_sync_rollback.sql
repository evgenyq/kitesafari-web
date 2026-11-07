-- Rollback for 010_sheet_sync.sql (extensions pg_net/pg_cron are left installed; harmless).
BEGIN;

SELECT cron.unschedule('sheet-sync-heal');
SELECT cron.unschedule('cron-history-cleanup');
DROP TRIGGER IF EXISTS sheet_sync_cabins ON cabins;
DROP TRIGGER IF EXISTS sheet_sync_trips ON trips;
DROP FUNCTION IF EXISTS notify_sheet_sync_trigger();
DROP FUNCTION IF EXISTS notify_sheet_sync();

COMMIT;
