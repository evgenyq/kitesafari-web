-- Rollback for 008_hide_cabin_guests.sql — guests readable by the public key again, Realtime back on.
BEGIN;

GRANT SELECT ON cabins TO anon, authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE cabins;

COMMIT;
