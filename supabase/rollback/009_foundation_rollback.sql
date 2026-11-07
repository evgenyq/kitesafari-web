-- Rollback for 009_foundation.sql — structure only.
-- Dropped tables/functions and their data are in ~/Projects/kitesafari-web-private/backup-2026-11-07/
-- (*.json per table, _functions.sql); restore them from there if ever needed.
BEGIN;

DROP TRIGGER IF EXISTS log_cabin_change ON cabins;
DROP FUNCTION IF EXISTS log_cabin_change();
DROP TABLE IF EXISTS cabin_changes;
ALTER TABLE cabins DROP COLUMN IF EXISTS changed_by;
DROP TABLE IF EXISTS notes;

COMMIT;
