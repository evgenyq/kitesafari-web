-- Migration: Add Row Level Security (RLS) policies
-- Purpose: Secure access to tables for Mini App users

-- Enable RLS on all tables
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE yachts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cabins ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- TRIPS POLICIES
-- ==========================================

-- Anyone can view active trips
CREATE POLICY "Anyone can view active trips"
ON trips FOR SELECT
USING (status IN ('active', 'Booking Open'));

-- Only admins can insert/update/delete trips
-- (Service role key will be used for admin operations)

-- ==========================================
-- YACHTS POLICIES
-- ==========================================

-- Anyone can view yachts
CREATE POLICY "Anyone can view yachts"
ON yachts FOR SELECT
USING (true);

-- ==========================================
-- CABINS POLICIES
-- ==========================================

-- Anyone can view cabins for active trips
CREATE POLICY "Anyone can view cabins"
ON cabins FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM trips
    WHERE trips.id = cabins.trip_id
    AND trips.status IN ('active', 'Booking Open')
  )
);

-- Service role can update cabins (via Edge Functions)
-- No direct update policy needed - handled by service role key

-- ==========================================
-- USERS POLICIES
-- ==========================================

-- Users can view their own data
CREATE POLICY "Users can view own data"
ON users FOR SELECT
USING (auth.uid() = id);

-- Users can update their own data
CREATE POLICY "Users can update own data"
ON users FOR UPDATE
USING (auth.uid() = id);

-- Service role can insert users (via Edge Functions during booking)
-- No insert policy needed - handled by service role key

-- ==========================================
-- BOOKINGS POLICIES
-- ==========================================

-- Users can view their own bookings
CREATE POLICY "Users can view own bookings"
ON bookings FOR SELECT
USING (user_id = auth.uid());

-- Service role can insert bookings (via Edge Functions)
-- No insert policy needed - handled by service role key

-- Service role can update bookings for payment tracking
-- No update policy needed - handled by service role key

-- ==========================================
-- ADMIN POLICIES (for future admin panel)
-- ==========================================

-- Admins can view all bookings
CREATE POLICY "Admins can view all bookings"
ON bookings FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.is_admin = true
  )
);

-- Admins can view all cabins
CREATE POLICY "Admins can view all cabins"
ON cabins FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.is_admin = true
  )
);

-- ==========================================
-- COMMENTS
-- ==========================================

COMMENT ON POLICY "Anyone can view active trips" ON trips IS 'Public access to active trips for Mini App';
COMMENT ON POLICY "Anyone can view yachts" ON yachts IS 'Public access to yacht information';
COMMENT ON POLICY "Anyone can view cabins" ON cabins IS 'Public access to cabins in active trips';
COMMENT ON POLICY "Users can view own data" ON users IS 'Users can only see their own profile';
COMMENT ON POLICY "Users can view own bookings" ON bookings IS 'Users can only see their own bookings';
COMMENT ON POLICY "Admins can view all bookings" ON bookings IS 'Admin users have full access to bookings';
