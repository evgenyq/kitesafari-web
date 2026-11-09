-- Migration: fix 016 (2026-11-09). The final duplicate-number check aliased cabins as "c", which clashes with the
-- function's variable c → "column reference c.yacht_id is ambiguous" on every card that creates or edits cabin fields.
-- Same function as 016 otherwise. Caught by tests/bot/setup.sh. Rollback: 016_tour_setup_rollback.sql (back to 011).

BEGIN;

CREATE OR REPLACE FUNCTION bot_apply_proposal(p_id uuid, p_actor text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  p bot_proposals%ROWTYPE;
  a jsonb;
  c cabins%ROWTYPE;
  cur jsonb;
  k text;
  dup text;
  touched uuid[] := '{}';
  conflicts jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO p FROM bot_proposals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR p.status <> 'pending' THEN
    RETURN jsonb_build_object('status', 'not_pending', 'current', COALESCE(p.status, 'missing'));
  END IF;

  -- 1. Checks: everything the card showed as "было" must still be so
  FOR a IN SELECT * FROM jsonb_array_elements(p.actions) LOOP
    IF a->>'type' = 'cabin' THEN
      SELECT * INTO c FROM cabins WHERE id = (a->>'cabin_id')::uuid FOR UPDATE;
      IF NOT FOUND
         OR COALESCE(c.guests, '') <> COALESCE(a->>'expected_guests', '')
         OR c.status IS DISTINCT FROM a->>'expected_status' THEN
        conflicts := conflicts || jsonb_build_object('cabin_id', a->>'cabin_id', 'current_guests', c.guests, 'current_status', c.status);
      END IF;

    ELSIF a->>'type' IN ('update_cabin_fields', 'delete_cabin') THEN
      SELECT to_jsonb(x) INTO cur FROM cabins x WHERE id = (a->>'cabin_id')::uuid FOR UPDATE;
      IF cur IS NULL THEN
        conflicts := conflicts || jsonb_build_object('cabin_id', a->>'cabin_id', 'reason', 'каюты больше нет');
      ELSIF a->>'type' = 'delete_cabin' AND COALESCE(cur->>'guests', '') <> '' THEN
        conflicts := conflicts || jsonb_build_object('cabin_id', a->>'cabin_id', 'reason', 'в каюте уже кто-то живёт: ' || (cur->>'guests'));
      ELSIF a->>'type' = 'delete_cabin' AND cur->>'status' NOT IN ('Available', 'Unavailable', 'STAFF') THEN
        conflicts := conflicts || jsonb_build_object('cabin_id', a->>'cabin_id', 'reason', 'каюта со статусом ' || (cur->>'status'));
      ELSIF a->>'type' = 'update_cabin_fields' THEN
        FOR k IN SELECT jsonb_object_keys(a->'expected') LOOP
          IF (CASE WHEN k = 'price' THEN (cur->>k)::numeric IS DISTINCT FROM (a->'expected'->>k)::numeric
                   ELSE (cur->>k) IS DISTINCT FROM (a->'expected'->>k) END) THEN
            conflicts := conflicts || jsonb_build_object('cabin_id', a->>'cabin_id', 'reason', k || ' сейчас ' || COALESCE(cur->>k, 'пусто'));
          END IF;
        END LOOP;
      END IF;

    ELSIF a->>'type' IN ('update_trip', 'update_yacht') THEN
      IF a->>'type' = 'update_trip' THEN
        SELECT to_jsonb(x) INTO cur FROM trips x WHERE id = (a->>'trip_id')::uuid FOR UPDATE;
      ELSE
        SELECT to_jsonb(x) INTO cur FROM yachts x WHERE id = (a->>'yacht_id')::uuid FOR UPDATE;
      END IF;
      IF cur IS NULL THEN
        conflicts := conflicts || jsonb_build_object('reason', 'тура/лодки больше нет');
      ELSIF a->>'type' = 'update_trip' AND jsonb_exists(a->'set', 'access_code')
            AND EXISTS (SELECT 1 FROM trips WHERE access_code = a->'set'->>'access_code' AND id <> (a->>'trip_id')::uuid) THEN
        conflicts := conflicts || jsonb_build_object('reason', 'код ссылки ' || (a->'set'->>'access_code') || ' уже занят');
      ELSIF a->>'type' = 'update_yacht' AND jsonb_exists(a->'set', 'name')
            AND EXISTS (SELECT 1 FROM yachts WHERE lower(name) = lower(a->'set'->>'name') AND id <> (a->>'yacht_id')::uuid) THEN
        conflicts := conflicts || jsonb_build_object('reason', 'лодка «' || (a->'set'->>'name') || '» уже есть');
      ELSE
        FOR k IN SELECT jsonb_object_keys(a->'expected') LOOP
          IF (cur->>k) IS DISTINCT FROM (a->'expected'->>k) THEN
            conflicts := conflicts || jsonb_build_object('reason', (cur->>'name') || ': ' || k || ' сейчас ' || COALESCE(cur->>k, 'пусто'));
          END IF;
        END LOOP;
      END IF;

    ELSIF a->>'type' = 'create_trip' THEN
      IF EXISTS (SELECT 1 FROM trips WHERE access_code = a->>'access_code') THEN
        conflicts := conflicts || jsonb_build_object('reason', 'код ссылки ' || (a->>'access_code') || ' уже занят другим туром');
      END IF;

    ELSIF a->>'type' = 'create_yacht' THEN
      IF EXISTS (SELECT 1 FROM yachts WHERE lower(name) = lower(a->>'name')) THEN
        conflicts := conflicts || jsonb_build_object('reason', 'лодка «' || (a->>'name') || '» уже есть');
      END IF;
    END IF;
  END LOOP;

  IF jsonb_array_length(conflicts) > 0 THEN
    UPDATE bot_proposals SET status = 'conflict', resolved_at = now() WHERE id = p_id;
    RETURN jsonb_build_object('status', 'conflict', 'conflicts', conflicts);
  END IF;

  -- 2. Apply in card order (the bot orders actions: yachts and trip before their cabins)
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

    ELSIF a->>'type' = 'create_yacht' THEN
      INSERT INTO yachts (id, notion_id, name, description, photos_urls, specifications)
      VALUES ((a->>'id')::uuid, gen_random_uuid()::text, a->>'name', NULLIF(a->>'description', ''), '{}', '{}'::jsonb);
    ELSIF a->>'type' = 'update_yacht' THEN
      UPDATE yachts SET
        name = COALESCE(a->'set'->>'name', name),
        description = CASE WHEN jsonb_exists(a->'set', 'description') THEN NULLIF(a->'set'->>'description', '') ELSE description END
      WHERE id = (a->>'yacht_id')::uuid;
    ELSIF a->>'type' = 'add_photo' THEN
      IF a->>'kind' = 'deck_plan' THEN
        UPDATE yachts SET deck_plan_urls = ARRAY[a->>'url'] || array_remove(COALESCE(deck_plan_urls, '{}'), a->>'url')
        WHERE id = (a->>'yacht_id')::uuid;
      ELSE
        UPDATE yachts SET photos_urls = array_remove(COALESCE(photos_urls, '{}'), a->>'url') || ARRAY[a->>'url']
        WHERE id = (a->>'yacht_id')::uuid;
      END IF;

    ELSIF a->>'type' = 'create_trip' THEN
      INSERT INTO trips (id, notion_id, name, start_date, end_date, status, description, photos_urls, access_code)
      VALUES ((a->>'id')::uuid, gen_random_uuid()::text, a->>'name', (a->>'start_date')::date, (a->>'end_date')::date,
              'Booking Open', NULLIF(a->>'description', ''), '{}', a->>'access_code');
    ELSIF a->>'type' = 'update_trip' THEN
      UPDATE trips SET
        name = COALESCE(a->'set'->>'name', name),
        start_date = COALESCE((a->'set'->>'start_date')::date, start_date),
        end_date = COALESCE((a->'set'->>'end_date')::date, end_date),
        access_code = COALESCE(a->'set'->>'access_code', access_code),
        status = COALESCE(a->'set'->>'status', status),
        description = CASE WHEN jsonb_exists(a->'set', 'description') THEN NULLIF(a->'set'->>'description', '') ELSE description END
      WHERE id = (a->>'trip_id')::uuid;

    ELSIF a->>'type' = 'create_cabin' THEN
      INSERT INTO cabins (id, notion_id, trip_id, yacht_id, cabin_number, deck, bed_type, price, max_guests, status)
      VALUES ((a->>'id')::uuid, gen_random_uuid()::text, (a->>'trip_id')::uuid, (a->>'yacht_id')::uuid, a->>'cabin_number',
              a->>'deck', a->>'bed_type', (a->>'price')::numeric, (a->>'max_guests')::int, a->>'status');
      touched := touched || (a->>'id')::uuid;
    ELSIF a->>'type' = 'update_cabin_fields' THEN
      UPDATE cabins SET
        cabin_number = COALESCE(a->'set'->>'cabin_number', cabin_number),
        deck = COALESCE(a->'set'->>'deck', deck),
        bed_type = COALESCE(a->'set'->>'bed_type', bed_type),
        price = COALESCE((a->'set'->>'price')::numeric, price),
        max_guests = COALESCE((a->'set'->>'max_guests')::int, max_guests),
        changed_by = p_actor
      WHERE id = (a->>'cabin_id')::uuid;
      touched := touched || (a->>'cabin_id')::uuid;
    ELSIF a->>'type' = 'delete_cabin' THEN
      DELETE FROM cabins WHERE id = (a->>'cabin_id')::uuid;
    END IF;
  END LOOP;

  -- 3. Final state: no cabin number twice on the same yacht in the same trip (raising rolls everything back)
  IF cardinality(touched) > 0 THEN
    SELECT yy.name || ' #' || cc.cabin_number INTO dup
    FROM cabins cc JOIN yachts yy ON yy.id = cc.yacht_id
    WHERE EXISTS (SELECT 1 FROM cabins tt WHERE tt.id = ANY(touched) AND tt.trip_id = cc.trip_id AND tt.yacht_id = cc.yacht_id)
    GROUP BY cc.trip_id, cc.yacht_id, yy.name, cc.cabin_number HAVING count(*) > 1 LIMIT 1;
    IF dup IS NOT NULL THEN
      RAISE EXCEPTION 'KS_CONFLICT: каюта % получилась дважды', dup;
    END IF;
  END IF;

  UPDATE bot_proposals SET status = 'applied', resolved_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('status', 'applied');
END;
$$;

REVOKE EXECUTE ON FUNCTION bot_apply_proposal(uuid, text) FROM public, anon, authenticated;

COMMIT;
