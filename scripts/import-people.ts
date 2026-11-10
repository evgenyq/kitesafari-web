// One-off import of people, their requests and facts from a JSON file (kept outside the repo: it has names).
//   KS_ENV=/path/to/env npx deno run --no-lock --allow-net --allow-env --allow-read scripts/import-people.ts people.json
// (KS_ENV file or the environment gives SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.)
// File: [{ name, username?, aliases?, about?, trip?: "trip name" | null, state?, since: "YYYY-MM-DD",
//          follow_up_at?, notes?: [{ date, text }] }]
// `since` becomes requests.created_at — the order people asked in is what the waitlist is sorted by.
// Idempotent: a person already there (same username, or same name when there is no username) is skipped whole.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const rows = JSON.parse(await Deno.readTextFile(Deno.args[0])) as any[]
const ACTOR = 'import'
const at = (date: string) => new Date(`${date}T12:00:00+03:00`).toISOString()

const { data: trips, error: tripsError } = await db.from('trips').select('id, name')
if (tripsError) throw tripsError
const tripId = (name: string | null | undefined) => {
  if (!name) return null
  const trip = trips!.find((t) => t.name === name)
  if (!trip) throw new Error(`Нет тура «${name}»`)
  return trip.id
}

// Check the whole file before the first insert: a person saved without their request would be skipped
// as "already there" on the next run and never get it.
const problems: string[] = []
for (const [i, row] of rows.entries()) {
  const where = `№${i + 1} ${row.name ?? '(без имени)'}`
  if (!row.name) problems.push(`${where}: нет name`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.since ?? '')) problems.push(`${where}: since не дата YYYY-MM-DD`)
  if (row.trip && !trips!.some((t) => t.name === row.trip)) problems.push(`${where}: нет тура «${row.trip}»`)
  if ((row.state ?? '').length > 300) problems.push(`${where}: state длиннее 300 знаков`)
  if ((row.about ?? '').length > 800) problems.push(`${where}: about длиннее 800 знаков`)
  if (row.follow_up_at && Number.isNaN(Date.parse(row.follow_up_at))) problems.push(`${where}: follow_up_at не дата`)
  for (const note of row.notes ?? []) if (!/^\d{4}-\d{2}-\d{2}$/.test(note.date ?? '') || !note.text) problems.push(`${where}: заметка без даты или текста`)
}
if (problems.length) { console.error(problems.join('\n')); Deno.exit(1) }

let created = 0, skipped = 0
for (const row of rows) {
  const username = row.username ? String(row.username).replace(/^@/, '').toLowerCase() : null
  const existing = username
    ? await db.from('people').select('id').eq('tg_username', username).limit(1)
    : await db.from('people').select('id').eq('name', row.name).is('tg_username', null).limit(1)
  if (existing.error) throw existing.error
  if (existing.data.length) { skipped++; console.log(`— уже есть: ${row.name}`); continue }

  let tgId: number | null = null
  if (username) {
    const { data: started } = await db.from('users').select('telegram_id, username').ilike('username', username).limit(5)
    const exact = (started ?? []).filter((u) => u.username?.toLowerCase() === username)
    if (exact.length === 1) tgId = Number(exact[0].telegram_id)
  }
  const { data: person, error } = await db.from('people')
    .insert({ name: row.name, tg_username: username, tg_user_id: tgId, aliases: row.aliases ?? null, about: row.about ?? null, created_at: at(row.since) })
    .select('id').single()
  if (error) throw new Error(`${row.name}: ${error.message}`)
  const trip = tripId(row.trip)
  if (row.state) {
    const { error: e } = await db.from('requests').insert({ person_id: person.id, trip_id: trip, state: row.state, follow_up_at: row.follow_up_at ?? null, created_at: at(row.since) })
    if (e) throw new Error(`${row.name}: ${e.message}`)
  }
  for (const note of row.notes ?? []) {
    const { error: e } = await db.from('notes').insert({ person_id: person.id, trip_id: trip, text: note.text, created_by: ACTOR, source: 'import', status: 'done', created_at: at(note.date) })
    if (e) throw new Error(`${row.name}: ${e.message}`)
  }
  created++
  console.log(`+ ${row.name}${username ? ` @${username}` : ''}${tgId ? ' (нажимал Start)' : ''}`)
}
console.log(`\nДобавлено: ${created}, пропущено (уже были): ${skipped}`)
