-- Migration: Foundation for the bot (2026-11-07), see docs/ARCHITECTURE.md
--   1. Drop legacy from the Python bot / Notion era: bookings, user_sessions, sync_log, their RPCs.
--   2. notes — the bot's notebook (waitlist, agreements, conditional requests; mini-app bookings land here too).
--   3. cabin_changes — journal of cabins.guests / cabins.status changes, written by a trigger.
--      Writers put who they are into cabins.changed_by; the trigger logs it and clears the column,
--      so a writer that doesn't set it is logged as unknown instead of inheriting the previous actor.
-- Backup of all dropped data: ~/Projects/kitesafari-web-private/backup-2026-11-07/
-- Rollback: supabase/rollback/009_foundation_rollback.sql (structure only; data from the backup)

BEGIN;

-- 1. Legacy
DROP TABLE bookings;
DROP TABLE user_sessions;
DROP TABLE sync_log;
DROP FUNCTION IF EXISTS
  cleanup_expired_sessions, get_admin_dashboard, get_available_cabins, get_complete_trip_data,
  get_trip_details, get_user_session, get_user_with_active_trip, save_user_session,
  update_user_last_active_trip, update_user_sessions_updated_at, log_guests_change;

-- 2. Notebook
CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id) ON DELETE SET NULL,
  text text NOT NULL,
  remind_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_by text,  -- 'admin:<telegram_id>', 'miniapp:<telegram_id>', 'bot', ...
  source text,      -- 'text', 'voice', 'forward', 'miniapp', 'sheet', ...
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_open_remind_idx ON notes (remind_at) WHERE status = 'open' AND remind_at IS NOT NULL;
CREATE INDEX notes_trip_idx ON notes (trip_id);
CREATE TRIGGER update_notes_updated_at BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 3. Cabin journal
ALTER TABLE cabins ADD COLUMN changed_by text;

CREATE TABLE cabin_changes (
  id bigserial PRIMARY KEY,
  cabin_id uuid NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text,
  old_guests text,
  new_guests text,
  old_status text,
  new_status text
);
CREATE INDEX cabin_changes_cabin_idx ON cabin_changes (cabin_id, changed_at DESC);

CREATE FUNCTION log_cabin_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.guests IS DISTINCT FROM OLD.guests OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO cabin_changes (cabin_id, changed_by, old_guests, new_guests, old_status, new_status)
    VALUES (NEW.id, NEW.changed_by, OLD.guests, NEW.guests, OLD.status, NEW.status);
  END IF;
  NEW.changed_by := NULL;
  RETURN NEW;
END;
$$;
CREATE TRIGGER log_cabin_change BEFORE UPDATE ON cabins
  FOR EACH ROW EXECUTE FUNCTION log_cabin_change();

-- New tables: service role only (edge functions). anon keeps its column grants on cabins (changed_by not granted).
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cabin_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notes, cabin_changes FROM anon, authenticated;
REVOKE ALL ON SEQUENCE cabin_changes_id_seq FROM anon, authenticated;

COMMIT;
