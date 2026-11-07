-- Migration: Telegram bot agent (2026-11-07), see docs/ARCHITECTURE.md "Бот: где живёт и как думает"
--   bot_messages   — conversation per chat (user text, bot answers, events like "applied"); user rows start unprocessed
--   bot_proposals  — changes waiting for "ок": cabin edits + notebook edits, applied all-or-nothing
--   bot_chat_locks — one worker per chat at a time; new messages are picked up by the running worker
-- Rollback: supabase/rollback/011_bot_rollback.sql

BEGIN;

CREATE TABLE bot_messages (
  id bigserial PRIMARY KEY,
  chat_id bigint NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'event')),
  text text NOT NULL,
  processed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bot_messages_chat_idx ON bot_messages (chat_id, id);
CREATE INDEX bot_messages_unprocessed_idx ON bot_messages (chat_id) WHERE NOT processed;

CREATE TABLE bot_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  created_by bigint NOT NULL,          -- telegram id of the admin the bot was talking to
  summary text NOT NULL,
  -- [{type:'cabin', cabin_id, expected_guests, expected_status, new_guests, new_status},
  --  {type:'add_note', text, trip_id, remind_at}, {type:'close_note', note_id}]
  actions jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'cancelled', 'conflict', 'superseded')),
  tg_message_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX bot_proposals_chat_pending_idx ON bot_proposals (chat_id) WHERE status = 'pending';

CREATE TABLE bot_chat_locks (
  chat_id bigint PRIMARY KEY,
  locked_until timestamptz NOT NULL
);

-- Take the chat lock if free or expired (a crashed worker frees it after 3 minutes).
CREATE FUNCTION bot_try_lock(p_chat bigint) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO bot_chat_locks (chat_id, locked_until) VALUES (p_chat, now() + interval '3 minutes')
  ON CONFLICT (chat_id) DO UPDATE SET locked_until = excluded.locked_until
    WHERE bot_chat_locks.locked_until < now();
  RETURN FOUND;
END;
$$;

-- Release only if no unprocessed messages arrived meanwhile; otherwise extend and tell the worker to go on.
-- Row lock first, so a concurrent bot_try_lock either sees the lock held (and its message is seen here)
-- or runs after the release.
CREATE FUNCTION bot_release_lock(p_chat bigint) RETURNS boolean LANGUAGE plpgsql AS $$
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

-- Apply a pending proposal atomically. Every cabin must still hold exactly what the card showed as "было";
-- otherwise nothing is applied and the conflicts are returned.
CREATE FUNCTION bot_apply_proposal(p_id uuid, p_actor text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  p bot_proposals%ROWTYPE;
  a jsonb;
  c cabins%ROWTYPE;
  conflicts jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO p FROM bot_proposals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR p.status <> 'pending' THEN
    RETURN jsonb_build_object('status', 'not_pending', 'current', COALESCE(p.status, 'missing'));
  END IF;

  FOR a IN SELECT * FROM jsonb_array_elements(p.actions) WHERE value->>'type' = 'cabin' LOOP
    SELECT * INTO c FROM cabins WHERE id = (a->>'cabin_id')::uuid FOR UPDATE;
    IF NOT FOUND
       OR COALESCE(c.guests, '') <> COALESCE(a->>'expected_guests', '')
       OR c.status IS DISTINCT FROM a->>'expected_status' THEN
      conflicts := conflicts || jsonb_build_object('cabin_id', a->>'cabin_id', 'current_guests', c.guests, 'current_status', c.status);
    END IF;
  END LOOP;

  IF jsonb_array_length(conflicts) > 0 THEN
    UPDATE bot_proposals SET status = 'conflict', resolved_at = now() WHERE id = p_id;
    RETURN jsonb_build_object('status', 'conflict', 'conflicts', conflicts);
  END IF;

  FOR a IN SELECT * FROM jsonb_array_elements(p.actions) LOOP
    IF a->>'type' = 'cabin' THEN
      UPDATE cabins SET
        guests = NULLIF(COALESCE(a->>'new_guests', guests), ''),
        status = COALESCE(a->>'new_status', status),
        changed_by = p_actor
      WHERE id = (a->>'cabin_id')::uuid;
    ELSIF a->>'type' = 'add_note' THEN
      INSERT INTO notes (trip_id, text, remind_at, created_by, source)
      VALUES ((a->>'trip_id')::uuid, a->>'text', (a->>'remind_at')::timestamptz, p_actor, 'bot');
    ELSIF a->>'type' = 'close_note' THEN
      UPDATE notes SET status = 'done' WHERE id = (a->>'note_id')::uuid;
    END IF;
  END LOOP;

  UPDATE bot_proposals SET status = 'applied', resolved_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('status', 'applied');
END;
$$;

-- Service role only (edge functions)
ALTER TABLE bot_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_chat_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bot_messages, bot_proposals, bot_chat_locks FROM anon, authenticated;
REVOKE ALL ON SEQUENCE bot_messages_id_seq FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION bot_try_lock(bigint), bot_release_lock(bigint), bot_apply_proposal(uuid, text)
  FROM public, anon, authenticated;

COMMIT;
