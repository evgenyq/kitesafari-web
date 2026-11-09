#!/bin/bash
# Live sheet-edit scenarios against prod (autumn-2026 tab only, restored afterwards). Unit tests: node --test tests/sheet/logic.test.ts
# Needs: Supabase CLI logged in (service key fetched at runtime, never printed), ~/Projects/kitesafaribot/{.env,google_credentials.json}.
set -e
cd "$(dirname "$0")/../.."
export SUPABASE_SERVICE_ROLE_KEY=$(npx supabase projects api-keys --project-ref zmbiiywazaytltemzzvc -o env 2>/dev/null | grep -i '^SUPABASE_SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')
git checkout -- supabase/.temp 2>/dev/null || true
node tests/sheet/live.mjs
