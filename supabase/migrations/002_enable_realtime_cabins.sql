-- Migration: Enable Realtime for cabins table
-- Purpose: Allow real-time updates when cabin status changes (race condition protection)

-- Enable Realtime replication for cabins table
ALTER PUBLICATION supabase_realtime ADD TABLE cabins;

-- Add comment for documentation
COMMENT ON TABLE cabins IS 'Cabins table with Realtime enabled for live status updates';
