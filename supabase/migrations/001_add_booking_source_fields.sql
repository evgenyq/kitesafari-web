-- Migration: Add booking_source and admin_booked_by fields to bookings table
-- Purpose: Track booking source (user/admin/miniapp) and admin who created booking

ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS booking_source TEXT DEFAULT 'user',
ADD COLUMN IF NOT EXISTS admin_booked_by BIGINT;

-- Add index for querying by booking source
CREATE INDEX IF NOT EXISTS idx_bookings_source ON bookings(booking_source);

-- Add comment for documentation
COMMENT ON COLUMN bookings.booking_source IS 'Source of booking: user, admin, or miniapp';
COMMENT ON COLUMN bookings.admin_booked_by IS 'Telegram ID of admin who created booking (if applicable)';
