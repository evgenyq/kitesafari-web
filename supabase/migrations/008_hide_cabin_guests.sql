-- Migration: Hide guest names from the public key (2026-11-07)
-- Problem: cabins.guests (names + Telegram handles) was readable by anyone with the anon key
-- from the site bundle, both via REST and via Realtime payloads.
--
-- After this migration:
--   anon/authenticated can SELECT every cabins column except guests.
--   Guests are served by the cabin-guests Edge Function (Telegram initData check).
--   cabins is removed from Realtime (payload carries the full row); the booking modal polls instead.
-- Rollback: supabase/rollback/008_hide_cabin_guests_rollback.sql

BEGIN;

REVOKE SELECT ON cabins FROM anon, authenticated;
GRANT SELECT (id, notion_id, trip_id, yacht_id, cabin_number, deck, bed_type, price, status,
              max_guests, created_at, updated_at, synced_at)
  ON cabins TO anon, authenticated;

ALTER PUBLICATION supabase_realtime DROP TABLE cabins;

COMMIT;
