-- Migration: bot run log (2026-11-07)
-- One row per agent turn or voice transcription: steps (model calls with token usage, tool calls with
-- arguments and a result preview), timings, estimated cost. For debugging "why did the bot say that"
-- and for knowing what the bot costs per month.
-- Rollback: supabase/rollback/013_bot_runs_rollback.sql

BEGIN;

CREATE TABLE bot_runs (
  id bigserial PRIMARY KEY,
  chat_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('agent', 'transcribe')),
  message_id bigint,              -- bot_messages.id the run answered (agent) or produced (transcribe)
  model text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  duration_ms integer,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_tokens integer NOT NULL DEFAULT 0,
  cached_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  audio_seconds integer,
  cost_usd numeric(10, 6),
  result text,                    -- the reply / the transcript
  error text
);
CREATE INDEX bot_runs_chat_idx ON bot_runs (chat_id, started_at DESC);

ALTER TABLE bot_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bot_runs FROM anon, authenticated;
REVOKE ALL ON SEQUENCE bot_runs_id_seq FROM anon, authenticated;

COMMIT;
