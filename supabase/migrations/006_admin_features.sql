-- Migration: Admin Features
-- Purpose: Add admin_users table and RLS policies for admin access

-- Create admin_users table
CREATE TABLE IF NOT EXISTS admin_users (
  telegram_id bigint PRIMARY KEY,
  telegram_username text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add index for fast lookups
CREATE INDEX IF NOT EXISTS idx_admin_users_telegram_id ON admin_users(telegram_id);

-- Insert initial admins
INSERT INTO admin_users (telegram_id, telegram_username) VALUES
  (58500313, 'evgenyq')
ON CONFLICT (telegram_id) DO NOTHING;

-- Enable RLS on admin_users
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can check if they are admin (needed for auth check)
CREATE POLICY "Anyone can check admin status"
  ON admin_users
  FOR SELECT
  USING (true);

-- Policy: Admins can read all bookings (bypass normal restrictions)
-- Note: This assumes bookings table already has RLS enabled
-- If not, this won't cause an error, just won't have effect yet
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'bookings') THEN
    DROP POLICY IF EXISTS "Admins can read all bookings" ON bookings;
    CREATE POLICY "Admins can read all bookings"
      ON bookings
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM admin_users
          WHERE admin_users.telegram_id = (current_setting('request.jwt.claims', true)::json->>'telegram_id')::bigint
        )
      );
  END IF;
END $$;

-- Policy: Admins can read all cabins
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'cabins') THEN
    ALTER TABLE cabins ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Admins can read all cabins" ON cabins;
    CREATE POLICY "Admins can read all cabins"
      ON cabins
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM admin_users
          WHERE admin_users.telegram_id = (current_setting('request.jwt.claims', true)::json->>'telegram_id')::bigint
        )
      );

    DROP POLICY IF EXISTS "Public can read cabins" ON cabins;
    CREATE POLICY "Public can read cabins"
      ON cabins
      FOR SELECT
      USING (true);
  END IF;
END $$;

-- Comment
COMMENT ON TABLE admin_users IS 'Users with admin privileges for kitesafari management';
COMMENT ON COLUMN admin_users.telegram_id IS 'Telegram user ID of the admin';
COMMENT ON COLUMN admin_users.telegram_username IS 'Telegram username for reference';
