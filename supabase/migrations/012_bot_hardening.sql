-- Migration: bot hardening after review (2026-11-07)
--   - dedupe Telegram re-deliveries: bot_messages.tg_message_id unique per chat
--   - chat lock lives 10 minutes (longer than the Edge Function wall clock), so a live worker never loses it
--   - bot_force_unlock for the worker's error path
-- Rollback: supabase/rollback/012_bot_hardening_rollback.sql

BEGIN;

ALTER TABLE bot_messages ADD COLUMN tg_message_id bigint;
-- Not partial: ON CONFLICT (chat_id, tg_message_id) from PostgREST must infer it; NULLs (bot rows) never conflict
CREATE UNIQUE INDEX bot_messages_tg_dedupe_idx ON bot_messages (chat_id, tg_message_id);

CREATE OR REPLACE FUNCTION bot_try_lock(p_chat bigint) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO bot_chat_locks (chat_id, locked_until) VALUES (p_chat, now() + interval '10 minutes')
  ON CONFLICT (chat_id) DO UPDATE SET locked_until = excluded.locked_until
    WHERE bot_chat_locks.locked_until < now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION bot_release_lock(p_chat bigint) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM bot_chat_locks WHERE chat_id = p_chat FOR UPDATE;
  IF EXISTS (SELECT 1 FROM bot_messages WHERE chat_id = p_chat AND NOT processed) THEN
    UPDATE bot_chat_locks SET locked_until = now() + interval '10 minutes' WHERE chat_id = p_chat;
    RETURN false;
  END IF;
  DELETE FROM bot_chat_locks WHERE chat_id = p_chat;
  RETURN true;
END;
$$;

CREATE FUNCTION bot_force_unlock(p_chat bigint) RETURNS void LANGUAGE sql AS $$
  DELETE FROM bot_chat_locks WHERE chat_id = p_chat;
$$;

REVOKE EXECUTE ON FUNCTION bot_try_lock(bigint), bot_release_lock(bigint), bot_force_unlock(bigint)
  FROM public, anon, authenticated;

COMMIT;
