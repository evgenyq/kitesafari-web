#!/bin/bash
# Bot scenario harness: real model + live DB, Telegram mocked locally, separate fake chat,
# only the past autumn-2026 trip is touched and restored afterwards.
#   OPENAI_API_KEY=... tests/bot/run.sh
# Needs: deno, Supabase CLI logged in (the service key is fetched at runtime and never printed).
set -e
cd "$(dirname "$0")/../.."
: "${OPENAI_API_KEY:?set OPENAI_API_KEY}"
export OPENAI_MODEL=${OPENAI_MODEL:-gpt-6.1-terra}
if [ -n "$KS_ENV" ]; then # a local database instead of the live one: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  set -a; . "$KS_ENV"; set +a
else
  export SUPABASE_URL=https://zmbiiywazaytltemzzvc.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=$(npx supabase projects api-keys --project-ref zmbiiywazaytltemzzvc -o env 2>/dev/null | grep -i '^SUPABASE_SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')
fi
export TELEGRAM_BOT_TOKEN=test
export TELEGRAM_API_BASE=http://localhost:8787
git checkout -- supabase/.temp 2>/dev/null || true
cd tests/bot && npx deno run --no-lock --allow-net --allow-env --allow-read harness.ts
