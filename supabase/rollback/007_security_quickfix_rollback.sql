-- Rollback for 007_security_quickfix.sql — restores the pre-fix (insecure) state exactly.
BEGIN;

CREATE POLICY "Allow all operations for authenticated users" ON bookings FOR ALL USING (true);
CREATE POLICY "Allow all operations for authenticated users" ON cabins FOR ALL USING (true);
CREATE POLICY "Allow all operations for authenticated users" ON trips FOR ALL USING (true);
CREATE POLICY "Allow all operations for authenticated users" ON user_sessions FOR ALL USING (true);
CREATE POLICY "Allow all operations for authenticated users" ON users FOR ALL USING (true);
CREATE POLICY "Allow all operations for authenticated users" ON yachts FOR ALL USING (true);
CREATE POLICY "Anyone can check admin status" ON admin_users FOR SELECT USING (true);

ALTER TABLE sync_log DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON admin_users, bookings, cabins, sync_log, trips, user_sessions, users, yachts
  TO anon, authenticated;

GRANT EXECUTE ON FUNCTION
  cleanup_expired_sessions, get_admin_dashboard, get_available_cabins, get_complete_trip_data,
  get_trip_details, get_user_session, get_user_with_active_trip, save_user_session,
  update_user_last_active_trip
  TO anon, authenticated, public;

COMMIT;
