-- Rollback for 019_follow_ups.sql: stop checking for due follow-ups.
BEGIN;
SELECT cron.unschedule('follow-ups');
DROP FUNCTION IF EXISTS notify_follow_ups();
COMMIT;
