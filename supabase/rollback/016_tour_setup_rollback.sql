-- Rollback for 016_tour_setup.sql: bot_apply_proposal as in 011 (cabins and notes only).
BEGIN;
CREATE OR REPLACE FUNCTION bot_apply_proposal(p_id uuid, p_actor text) RETURNS jsonb LANGUAGE plpgsql AS $$
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
COMMIT;
