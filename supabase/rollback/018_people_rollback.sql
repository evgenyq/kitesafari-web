-- Rollback for 018_people.sql. Drops people, requests and their journal; notes keep their text.
-- Roll 019 back first: its cron job reads these tables.
BEGIN;

DROP TRIGGER IF EXISTS trips_close_requests ON trips;
DROP FUNCTION IF EXISTS close_requests_of_deleted_trip();
DELETE FROM bot_runs WHERE kind = 'guest';
ALTER TABLE bot_runs DROP CONSTRAINT bot_runs_kind_check;
ALTER TABLE bot_runs ADD CONSTRAINT bot_runs_kind_check CHECK (kind IN ('agent', 'transcribe'));

DROP FUNCTION IF EXISTS merge_people(uuid, uuid, text);
ALTER TABLE notes DROP COLUMN IF EXISTS person_id;
ALTER TABLE notes DROP COLUMN IF EXISTS reminded_at;
ALTER TABLE admin_users DROP COLUMN IF EXISTS notify;
DROP TABLE IF EXISTS people_changes;
DROP TABLE IF EXISTS requests;
DROP TABLE IF EXISTS people;
DROP FUNCTION IF EXISTS log_person_change();
DROP FUNCTION IF EXISTS log_request_change();

COMMIT;
