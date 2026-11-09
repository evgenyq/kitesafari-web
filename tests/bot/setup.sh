#!/bin/bash
# Tour setup through the bot without the model: live DB, Telegram mocked, a 2020 test trip created and deleted.
# Needs: Supabase CLI logged in (service key fetched at runtime, never printed).
set -e
cd "$(dirname "$0")/../.."
export SUPABASE_URL=https://zmbiiywazaytltemzzvc.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=$(npx supabase projects api-keys --project-ref zmbiiywazaytltemzzvc -o env 2>/dev/null | grep -i '^SUPABASE_SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')
export TELEGRAM_BOT_TOKEN=test
export TELEGRAM_API_BASE=http://localhost:8787
git checkout -- supabase/.temp 2>/dev/null || true
cd tests/bot && npx deno run --no-lock --allow-net --allow-env --allow-read setup_test.ts
