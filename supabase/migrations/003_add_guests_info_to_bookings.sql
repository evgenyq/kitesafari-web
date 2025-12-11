-- Migration: Add guests_info field to bookings table
-- Purpose: Store additional guest information in flexible format

ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS guests_info TEXT;

-- Add comment for documentation
COMMENT ON COLUMN bookings.guests_info IS 'Additional guest information: "@username Name, second_guest_freetext"';
