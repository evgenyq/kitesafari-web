-- People and requests: the "lazy CRM" layer.
--   people    — a contact (someone the organisers or the bot talk to). Companions without
--               their own Telegram (children, partners) are a line of text, not a row.
--   requests  — one open matter of a person, usually about one trip: free-text state
--               instead of a status list, plus an optional date to come back to it.
--               Only for the undecided (waiting, soft commit, cancelling, "we want to invite");
--               a settled guest lives in cabins.guests only.
--   notes.person_id — notes become the append-only feed of facts about a person;
--               requests.state and people.about are summaries that can be rebuilt from it.
--   people_changes  — journal of every edit of the two rewritable texts, written by trigger.
BEGIN;

CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tg_user_id bigint UNIQUE,
  tg_username text,   -- without @, lower case; NOT unique: usernames change and get reused
  aliases text,       -- other spellings, old usernames, Instagram
  about text CHECK (char_length(about) <= 800),  -- only what holds between trips
  changed_by text,    -- set by the writer, moved to the journal and cleared by the trigger
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX people_username_idx ON people (tg_username);

CREATE TABLE requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  trip_id uuid REFERENCES trips(id) ON DELETE SET NULL,  -- NULL = "the next one / some day"
  state text NOT NULL CHECK (char_length(state) <= 300),
  follow_up_at timestamptz,  -- NULL = waits for an event, not for a date
  follow_up_sent_at timestamptz,  -- the reminder for this follow_up_at went out (cleared when the date moves)
  closed_at timestamptz,
  changed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One open request per person and trip (and one open "no trip yet" request per person).
CREATE UNIQUE INDEX requests_open_person_trip_idx ON requests (person_id, trip_id)
  WHERE closed_at IS NULL AND trip_id IS NOT NULL;
CREATE UNIQUE INDEX requests_open_person_no_trip_idx ON requests (person_id)
  WHERE closed_at IS NULL AND trip_id IS NULL;
CREATE INDEX requests_open_trip_idx ON requests (trip_id, created_at) WHERE closed_at IS NULL;
CREATE INDEX requests_due_idx ON requests (follow_up_at)
  WHERE closed_at IS NULL AND follow_up_at IS NOT NULL;

ALTER TABLE notes ADD COLUMN person_id uuid REFERENCES people(id) ON DELETE SET NULL;
ALTER TABLE notes ADD COLUMN reminded_at timestamptz;  -- the reminder for remind_at went out
-- Reminders start with migration 019: dates that passed before it must not all fire on the first run
UPDATE notes SET reminded_at = now() WHERE remind_at <= now();
-- Guest turns are logged apart from the organisers' ones: there is a daily budget on them
ALTER TABLE bot_runs DROP CONSTRAINT bot_runs_kind_check;
ALTER TABLE bot_runs ADD CONSTRAINT bot_runs_kind_check CHECK (kind IN ('agent', 'guest', 'transcribe'));
-- Who gets the bot's own messages (new applications, due follow-ups). An admin can have access without them.
ALTER TABLE admin_users ADD COLUMN notify boolean NOT NULL DEFAULT true;
CREATE INDEX notes_person_idx ON notes (person_id, created_at DESC);

CREATE TABLE people_changes (
  id bigserial PRIMARY KEY,
  person_id uuid NOT NULL,
  request_id uuid,
  field text NOT NULL,
  old_value text,
  new_value text,
  changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX people_changes_person_idx ON people_changes (person_id, changed_at DESC);

CREATE FUNCTION log_person_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    INSERT INTO people_changes (person_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'name', OLD.name, NEW.name, NEW.changed_by);
  END IF;
  IF NEW.tg_username IS DISTINCT FROM OLD.tg_username THEN
    INSERT INTO people_changes (person_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'tg_username', OLD.tg_username, NEW.tg_username, NEW.changed_by);
  END IF;
  IF NEW.aliases IS DISTINCT FROM OLD.aliases THEN
    INSERT INTO people_changes (person_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'aliases', OLD.aliases, NEW.aliases, NEW.changed_by);
  END IF;
  IF NEW.about IS DISTINCT FROM OLD.about THEN
    INSERT INTO people_changes (person_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'about', OLD.about, NEW.about, NEW.changed_by);
  END IF;
  NEW.changed_by := NULL;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER people_log_change BEFORE UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION log_person_change();

CREATE FUNCTION log_request_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO people_changes (person_id, request_id, field, old_value, new_value, changed_by)
    VALUES (NEW.person_id, NEW.id, 'state', OLD.state, NEW.state, NEW.changed_by);
  END IF;
  IF NEW.follow_up_at IS DISTINCT FROM OLD.follow_up_at THEN
    NEW.follow_up_sent_at := NULL;
    INSERT INTO people_changes (person_id, request_id, field, old_value, new_value, changed_by)
    VALUES (NEW.person_id, NEW.id, 'follow_up_at', OLD.follow_up_at::text, NEW.follow_up_at::text, NEW.changed_by);
  END IF;
  IF NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    INSERT INTO people_changes (person_id, request_id, field, old_value, new_value, changed_by)
    VALUES (NEW.person_id, NEW.id, 'closed_at', OLD.closed_at::text, NEW.closed_at::text, NEW.changed_by);
  END IF;
  NEW.changed_by := NULL;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER requests_log_change BEFORE UPDATE ON requests
  FOR EACH ROW EXECUTE FUNCTION log_request_change();

-- A deleted trip would leave its requests with trip_id NULL, and two open "no trip" requests of one person
-- break the unique index (the delete would fail). They are about a trip that no longer exists: close them.
CREATE FUNCTION close_requests_of_deleted_trip() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE requests SET closed_at = now(), follow_up_at = NULL, changed_by = 'trip deleted'
  WHERE trip_id = OLD.id AND closed_at IS NULL;
  RETURN OLD;
END $$;
CREATE TRIGGER trips_close_requests BEFORE DELETE ON trips
  FOR EACH ROW EXECUTE FUNCTION close_requests_of_deleted_trip();

-- Two rows turned out to be one person: move everything to `p_keep`, remember the other names, drop `p_drop`.
-- An open request of the dropped row that collides with one of the kept row (same trip) is removed and
-- its text kept as a note, so nothing said about the person is lost.
CREATE FUNCTION merge_people(p_keep uuid, p_drop uuid, p_actor text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  k people%ROWTYPE;
  d people%ROWTYPE;
  r requests%ROWTYPE;
BEGIN
  IF p_keep = p_drop THEN RAISE EXCEPTION 'KS_MERGE: одна и та же запись'; END IF;
  SELECT * INTO k FROM people WHERE id = p_keep FOR UPDATE;
  SELECT * INTO d FROM people WHERE id = p_drop FOR UPDATE;
  IF k.id IS NULL OR d.id IS NULL THEN RAISE EXCEPTION 'KS_MERGE: человек не найден'; END IF;
  IF k.tg_user_id IS NOT NULL AND d.tg_user_id IS NOT NULL AND k.tg_user_id <> d.tg_user_id THEN
    RAISE EXCEPTION 'KS_MERGE: у записей разные Telegram-аккаунты';
  END IF;

  FOR r IN SELECT * FROM requests WHERE person_id = p_drop LOOP
    IF r.closed_at IS NULL AND EXISTS (
      SELECT 1 FROM requests x WHERE x.person_id = p_keep AND x.closed_at IS NULL AND x.trip_id IS NOT DISTINCT FROM r.trip_id
    ) THEN
      INSERT INTO notes (person_id, trip_id, text, created_by, source, status)
      VALUES (p_keep, r.trip_id, 'Из объединённой записи «' || d.name || '»: ' || r.state, p_actor, 'merge', 'done');
      DELETE FROM requests WHERE id = r.id;
    ELSE
      UPDATE requests SET person_id = p_keep, changed_by = p_actor WHERE id = r.id;
    END IF;
  END LOOP;
  UPDATE notes SET person_id = p_keep WHERE person_id = p_drop;
  UPDATE people_changes SET person_id = p_keep WHERE person_id = p_drop;

  DELETE FROM people WHERE id = p_drop;  -- frees the unique tg_user_id before it moves to the kept row
  UPDATE people SET
    tg_user_id = COALESCE(k.tg_user_id, d.tg_user_id),
    tg_username = COALESCE(k.tg_username, d.tg_username),
    aliases = NULLIF(concat_ws('; ', NULLIF(k.aliases, ''), d.name,
      CASE WHEN d.tg_username IS DISTINCT FROM COALESCE(k.tg_username, d.tg_username) THEN '@' || d.tg_username END,
      NULLIF(d.aliases, '')), ''),
    about = COALESCE(k.about, d.about),
    changed_by = p_actor
  WHERE id = p_keep;
  IF d.about IS NOT NULL AND k.about IS NOT NULL AND d.about <> k.about THEN
    INSERT INTO notes (person_id, text, created_by, source, status)
    VALUES (p_keep, 'Из объединённой записи «' || d.name || '»: ' || d.about, p_actor, 'merge', 'done');
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION merge_people(uuid, uuid, text) FROM public, anon, authenticated;

-- Service role only, like notes: names, wishes and debts never reach the public key.
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE people_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON people, requests, people_changes FROM anon, authenticated;
REVOKE ALL ON SEQUENCE people_changes_id_seq FROM anon, authenticated;

COMMIT;
