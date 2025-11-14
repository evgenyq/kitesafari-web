-- Supabase Row Level Security (RLS) Policies для kitesafari-web
-- Этот скрипт настраивает read-only доступ для публичного ANON_KEY

-- Enable RLS на всех таблицах
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE yachts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cabins ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- ============================================
-- PUBLIC READ POLICIES (для frontend)
-- ============================================

-- Trips: разрешить чтение всем
CREATE POLICY "Allow public read trips"
ON trips FOR SELECT
USING (true);

-- Yachts: разрешить чтение всем
CREATE POLICY "Allow public read yachts"
ON yachts FOR SELECT
USING (true);

-- Cabins: разрешить чтение всем
CREATE POLICY "Allow public read cabins"
ON cabins FOR SELECT
USING (true);

-- Users: запретить чтение обычным пользователям (optional, если не нужно)
-- CREATE POLICY "Deny public read users"
-- ON users FOR SELECT
-- USING (false);

-- Bookings: запретить чтение обычным пользователям (optional)
-- CREATE POLICY "Deny public read bookings"
-- ON bookings FOR SELECT
-- USING (false);

-- ============================================
-- DENY ALL WRITE OPERATIONS для ANON
-- ============================================

-- Trips: запретить INSERT, UPDATE, DELETE
CREATE POLICY "Deny public insert trips"
ON trips FOR INSERT
WITH CHECK (false);

CREATE POLICY "Deny public update trips"
ON trips FOR UPDATE
USING (false);

CREATE POLICY "Deny public delete trips"
ON trips FOR DELETE
USING (false);

-- Yachts: запретить INSERT, UPDATE, DELETE
CREATE POLICY "Deny public insert yachts"
ON yachts FOR INSERT
WITH CHECK (false);

CREATE POLICY "Deny public update yachts"
ON yachts FOR UPDATE
USING (false);

CREATE POLICY "Deny public delete yachts"
ON yachts FOR DELETE
USING (false);

-- Cabins: запретить INSERT, UPDATE, DELETE
CREATE POLICY "Deny public insert cabins"
ON cabins FOR INSERT
WITH CHECK (false);

CREATE POLICY "Deny public update cabins"
ON cabins FOR UPDATE
USING (false);

CREATE POLICY "Deny public delete cabins"
ON cabins FOR DELETE
USING (false);

-- Users: запретить все операции
CREATE POLICY "Deny public insert users"
ON users FOR INSERT
WITH CHECK (false);

CREATE POLICY "Deny public update users"
ON users FOR UPDATE
USING (false);

CREATE POLICY "Deny public delete users"
ON users FOR DELETE
USING (false);

-- Bookings: запретить все операции
CREATE POLICY "Deny public insert bookings"
ON bookings FOR INSERT
WITH CHECK (false);

CREATE POLICY "Deny public update bookings"
ON bookings FOR UPDATE
USING (false);

CREATE POLICY "Deny public delete bookings"
ON bookings FOR DELETE
USING (false);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Проверить что RLS включен на всех таблицах:
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('trips', 'yachts', 'cabins', 'users', 'bookings');

-- Показать все политики:
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
