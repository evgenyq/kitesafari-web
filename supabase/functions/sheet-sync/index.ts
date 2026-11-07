// Edge Function: sheet-sync
// Purpose: keep the "Kite Safari" Google Sheet as a live view of the DB — one tab per current/future trip.
// Called by a DB trigger on cabins/trips changes (pg_net) and by pg_cron every minute as a healer
// (migration 010). Auth: x-sync-secret header == SHEET_SYNC_SECRET.
//
// Tab layout (see docs/ARCHITECTURE.md, "Правка прямо в Google-таблице"):
//   row 1  — banner (last update / pause notice)
//   row 2  — headers
//   row 3+ — one row per cabin: A Яхта | B Каюта | C Палуба | D Тип | E Цена | F Статус | G Кто живёт
//            hidden: H guests as last written by the server | I status as last written | J cabin id
// If a human changed F or G (visible ≠ hidden), the tab is "dirty": the server doesn't write it (only the
// banner), so manual work is never overwritten. Applying such edits to the DB comes with the "Применить" step.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { sheetsApi } from '../_shared/google.ts'

const SPREADSHEET_ID = Deno.env.get('GOOGLE_SHEET_ID')!
const SYNC_SECRET = Deno.env.get('SHEET_SYNC_SECRET')!
const COLS = 10 // A..J
const HEADERS = ['Яхта', 'Каюта', 'Палуба', 'Тип', 'Цена (€)', 'Статус', 'Кто живёт', '_гости', '_статус', '_id']
const STATUS_LABELS: Record<string, string> = {
  'Available': 'Свободна',
  'Half Available': 'Половина свободна',
  'Booked': 'Занята',
  'Paid': 'Оплачена',
  'Unavailable': 'Недоступна',
  'STAFF': 'STAFF',
}

type Grid = string[][]

interface Trip {
  id: string
  name: string
  start_date: string
  cabins: { id: string; cabin_number: string; deck: string | null; bed_type: string | null; price: number | null; status: string; guests: string | null; yachts: { name: string } | null }[]
}

const tabTitle = (trip: Trip) => `${trip.name} (${trip.start_date})`
const a1 = (title: string, range: string) => `'${title.replace(/'/g, "''")}'!${range}`
const pad = (row: string[] = []) => Array.from({ length: COLS }, (_, i) => String(row[i] ?? ''))
const nowLabel = () => new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function cabinRows(trip: Trip): Grid {
  return [...trip.cabins]
    .sort((a, b) => (a.yachts?.name ?? '').localeCompare(b.yachts?.name ?? '') || parseInt(a.cabin_number) - parseInt(b.cabin_number))
    .map((c) => {
      const status = STATUS_LABELS[c.status] ?? c.status
      const guests = c.guests ?? ''
      return pad([c.yachts?.name ?? '', c.cabin_number, c.deck ?? '', c.bed_type ?? '', c.price == null ? '' : String(c.price), status, guests, guests, status, c.id])
    })
}

/** Rows a human changed in the visible columns since the server last wrote them. */
function dirtyRows(current: Grid): number[] {
  const dirty: number[] = []
  current.forEach((row, i) => {
    if (i < 2 || !row[9]) return
    if (row[6] !== row[7] || row[5] !== row[8]) dirty.push(i + 1)
  })
  return dirty
}

/** Same cabins in the same order with the expected header — otherwise the tab is rebuilt from scratch. */
function sameShape(current: Grid, desired: Grid): boolean {
  if (current.length < 2 || current[1].join('|') !== HEADERS.join('|')) return false
  const ids = (g: Grid) => g.slice(2).map((r) => r[9]).join('|')
  return ids(current) === ids(desired)
}

function formatRequests(sheetId: number, rowCount: number, existingRules: number) {
  const range = (r0: number, r1: number, c0: number, c1: number) => ({ sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 })
  const statusRule = (text: string, rgb: { red: number; green: number; blue: number }) => ({
    addConditionalFormatRule: { index: 0, rule: { ranges: [range(2, rowCount, 5, 6)], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: text }] }, format: { backgroundColor: rgb } } } },
  })
  return [
    ...Array.from({ length: existingRules }, () => ({ deleteConditionalFormatRule: { sheetId, index: 0 } })),
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 2 } }, fields: 'gridProperties.frozenRowCount' } },
    // Reset everything first: old export tabs carry their own header styling in row 1
    { repeatCell: { range: range(0, rowCount, 0, COLS), cell: { userEnteredFormat: {} }, fields: 'userEnteredFormat' } },
    { repeatCell: { range: range(0, 1, 0, COLS), cell: { userEnteredFormat: { textFormat: { italic: true, foregroundColor: { red: 0.4, green: 0.4, blue: 0.4 } } } }, fields: 'userEnteredFormat.textFormat' } },
    { repeatCell: { range: range(1, 2, 0, COLS), cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, backgroundColor: { red: 0.26, green: 0.52, blue: 0.96 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 7, endIndex: 10 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 420 }, fields: 'pixelSize' } },
    { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 6 } } },
    statusRule('Свободна', { red: 0.85, green: 0.94, blue: 0.83 }),
    statusRule('Половина свободна', { red: 1, green: 0.95, blue: 0.8 }),
  ]
}

async function syncTrip(trip: Trip, tabs: Map<string, { sheetId: number; rules: number }>): Promise<string> {
  const title = tabTitle(trip)
  const rows = cabinRows(trip)
  let tab = tabs.get(title)

  if (!tab) {
    const res = await sheetsApi(SPREADSHEET_ID, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }) })
    tab = { sheetId: res.replies[0].addSheet.properties.sheetId, rules: 0 }
  }

  const current: Grid = ((await sheetsApi(SPREADSHEET_ID, `/values/${encodeURIComponent(a1(title, 'A1:J'))}`)).values ?? []).map(pad)

  const dirty = dirtyRows(current)
  if (dirty.length) {
    const banner = `⏸ Витрина на паузе: в строках ${dirty.join(', ')} ручные правки, которые ещё не применены к базе. Верните как было — и витрина снова начнёт обновляться.`
    if (current[0]?.[0] !== banner) {
      await sheetsApi(SPREADSHEET_ID, `/values/${encodeURIComponent(a1(title, 'A1'))}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [[banner]] }) })
    }
    return `${title}: paused (dirty rows ${dirty.join(',')})`
  }

  const body = [HEADERS, ...rows]
  const desired = [pad([`Обновляется автоматически из базы. Не редактируйте — правка из таблицы появится позже. Обновлено ${nowLabel()}`]), ...body.map(pad)]
  const paused = current[0]?.[0]?.startsWith('⏸') // leftover pause banner must be replaced even if data matches
  const unchanged = !paused && sameShape(current, desired) && current.slice(1).every((r, i) => r.join('\u0001') === desired[i + 1].join('\u0001'))
  if (unchanged) return `${title}: up to date`

  const rebuild = !sameShape(current, desired)
  if (rebuild) {
    await sheetsApi(SPREADSHEET_ID, `/values/${encodeURIComponent(a1(title, 'A1:Z'))}:clear`, { method: 'POST' })
  } else if (current.length > desired.length) {
    await sheetsApi(SPREADSHEET_ID, `/values/${encodeURIComponent(a1(title, `A${desired.length + 1}:J${current.length}`))}:clear`, { method: 'POST' })
  }
  await sheetsApi(SPREADSHEET_ID, `/values/${encodeURIComponent(a1(title, 'A1'))}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: desired }) })
  if (rebuild) {
    await sheetsApi(SPREADSHEET_ID, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: formatRequests(tab.sheetId, desired.length, tab.rules) }) })
  }
  return `${title}: ${rebuild ? 'rebuilt' : 'updated'}`
}

Deno.serve(async (req) => {
  if (req.headers.get('x-sync-secret') !== SYNC_SECRET) return new Response('Forbidden', { status: 403 })

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
    const { data: trips, error } = await supabase
      .from('trips')
      .select('id, name, start_date, cabins(id, cabin_number, deck, bed_type, price, status, guests, yachts(name))')
      .gte('end_date', since)
      .returns<Trip[]>()
    if (error) throw error

    const meta = await sheetsApi(SPREADSHEET_ID, '?fields=sheets(properties(sheetId,title),conditionalFormats)')
    const tabs = new Map<string, { sheetId: number; rules: number }>(
      meta.sheets.map((s: any) => [s.properties.title, { sheetId: s.properties.sheetId, rules: s.conditionalFormats?.length ?? 0 }]),
    )

    const results: string[] = []
    for (const trip of trips ?? []) {
      try {
        results.push(await syncTrip(trip, tabs))
      } catch (err) {
        console.error(`sheet-sync ${trip.name}:`, err)
        results.push(`${tabTitle(trip)}: error ${String(err).slice(0, 200)}`)
      }
    }
    return Response.json({ ok: true, results })
  } catch (err) {
    console.error('sheet-sync failed:', err)
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  }
})
