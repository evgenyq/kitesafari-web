-- Migration: Security quick fix (2026-11-02)
-- Problem: every table had a policy "Allow all operations for authenticated users"
-- with roles {public} and USING (true), so the public anon key (shipped in the site bundle)
-- could read/insert/update/delete everything, incl. users (phones/emails) and bookings.
--
-- After this migration:
--   anon/authenticated can only SELECT trips (open statuses), yachts, cabins — what the mini-app reads.
--   Everything else (writes, users, bookings, admin_users) is service_role only (edge functions).
-- Rollback: supabase/rollback/007_security_quickfix_rollback.sql

BEGIN;

-- 1. Drop the wide-open policies
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON bookings;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON cabins;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON trips;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON user_sessions;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON users;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON yachts;

-- admin list must not be public (only _shared/auth.ts reads it, with service role)
DROP POLICY IF EXISTS "Anyone can check admin status" ON admin_users;

-- 2. sync_log had RLS disabled
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;

-- 3. Defense in depth: table grants
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON admin_users, bookings, cabins, sync_log, trips, user_sessions, users, yachts
  FROM anon, authenticated;
REVOKE SELECT ON admin_users, bookings, sync_log, user_sessions, users FROM anon, authenticated;

-- 4. Legacy RPCs from the Python bot era: nothing in the web app calls them
REVOKE EXECUTE ON FUNCTION
  cleanup_expired_sessions, get_admin_dashboard, get_available_cabins, get_complete_trip_data,
  get_trip_details, get_user_session, get_user_with_active_trip, save_user_session,
  update_user_last_active_trip
  FROM anon, authenticated, public;

COMMIT;
