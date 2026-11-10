#!/bin/bash
# People, requests, follow-ups and guest applications without the model. Telegram is mocked.
#   tests/bot/people.sh                 — live DB (test people «ТЕСТ …» are created and deleted; the parts that
#                                         message admins are skipped)
#   KS_ENV=/path/to/local.env tests/bot/people.sh — a local database (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY): everything
set -e
cd "$(dirname "$0")/../.."
if [ -n "$KS_ENV" ]; then
  set -a; . "$KS_ENV"; set +a
else
  export SUPABASE_URL=https://zmbiiywazaytltemzzvc.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=$(npx supabase projects api-keys --project-ref zmbiiywazaytltemzzvc -o env 2>/dev/null | grep -i '^SUPABASE_SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')
  git checkout -- supabase/.temp 2>/dev/null || true
fi
export TELEGRAM_BOT_TOKEN=test
export TELEGRAM_API_BASE=http://localhost:8787
cd tests/bot && npx deno run --no-lock --allow-net --allow-env --allow-read people_test.ts
