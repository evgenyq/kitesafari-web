-- Rollback for 012_bot_hardening.sql (lock functions go back to 3-minute leases from 011)
BEGIN;

DROP FUNCTION IF EXISTS bot_force_unlock(bigint);
DROP INDEX IF EXISTS bot_messages_tg_dedupe_idx;
ALTER TABLE bot_messages DROP COLUMN IF EXISTS tg_message_id;

CREATE OR REPLACE FUNCTION bot_try_lock(p_chat bigint) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO bot_chat_locks (chat_id, locked_until) VALUES (p_chat, now() + interval '3 minutes')
  ON CONFLICT (chat_id) DO UPDATE SET locked_until = excluded.locked_until
    WHERE bot_chat_locks.locked_until < now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION bot_release_lock(p_chat bigint) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM bot_chat_locks WHERE chat_id = p_chat FOR UPDATE;
  IF EXISTS (SELECT 1 FROM bot_messages WHERE chat_id = p_chat AND NOT processed) THEN
    UPDATE bot_chat_locks SET locked_until = now() + interval '3 minutes' WHERE chat_id = p_chat;
    RETURN false;
  END IF;
  DELETE FROM bot_chat_locks WHERE chat_id = p_chat;
  RETURN true;
END;
$$;

COMMIT;
