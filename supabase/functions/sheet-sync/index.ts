// Edge Function: sheet-sync
// Purpose: the "Kite Safari" Google Sheet as a live view of the DB (one tab per current/future trip) that can also
// be edited: change «Кто живёт» / «Статус», tick «Применить» — the server applies the edits with a check.
// Called by a DB trigger on cabins/trips changes (pg_net) and by pg_cron every 10 seconds (migrations 010, 014).
// Auth: x-sync-secret header == SHEET_SYNC_SECRET. One run at a time (sheet_sync_try_lock).
// Layout and pure logic: ./logic.ts. Edits are applied via bot_apply_proposal (all-or-nothing, actor 'таблица').

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { sheetsApi } from '../_shared/google.ts'
import { sendText } from '../_shared/telegram.ts'
import {
  analyze, buildActions, buildGrid, C, cabinLabel, CONFIRMED, COLS, type DbCabin, FORMAT_VERSION, orangeRows, OUR_ROW1_LABEL, pad, pendingChanges,
  REMIND_MS, type Row, sameRows, sameShape, statusLabel, STATUS_OPTIONS, str,
} from './logic.ts'

const SPREADSHEET_ID = Deno.env.get('GOOGLE_SHEET_ID')!
const SYNC_SECRET = Deno.env.get('SHEET_SYNC_SECRET')!
const ACTOR = 'таблица'

interface Trip {
  id: string
  name: string
  start_date: string
  cabins: { id: string; cabin_number: string; deck: string | null; bed_type: string | null; price: number | null; status: string; guests: string | null; yachts: { name: string } | null }[]
}
type Tab = { sheetId: number; rules: number }
type GetTab = () => Promise<Tab>
type Update = { range: string; values: Row[] }

const tabTitle = (trip: Trip) => `${trip.name} (${trip.start_date})`
const a1 = (title: string, range: string) => `'${title.replace(/'/g, "''")}'!${range}`
const nowLabel = () => new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const isTrue = (v: Row[number] | undefined) => v === true || str(v).toUpperCase() === 'TRUE'
const STALE_BANNER = /^(⏸|✏️|⚠️|❌|🟧)/ // states that stop being true once the tab is clean again

const toDb = (trip: Trip): DbCabin[] => trip.cabins.map((c) => ({
  id: c.id,
  yacht: c.yachts?.name ?? '',
  num: c.cabin_number,
  deck: c.deck ?? '',
  type: c.bed_type ?? '',
  price: c.price == null ? '' : String(c.price),
  status: c.status,
  guests: c.guests ?? '',
}))

/** All tabs in one request: Google allows 60 reads a minute per service account and we poll every 10 s. */
async function readGrids(titles: string[]): Promise<Row[][]> {
  if (!titles.length) return []
  const ranges = titles.map((t) => `ranges=${encodeURIComponent(a1(t, 'A1:M'))}`).join('&')
  const res = await sheetsApi(SPREADSHEET_ID, `/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&${ranges}`)
  return res.valueRanges.map((vr: { values?: Row[] }) => (vr.values ?? []).map((r) => pad(r)))
}

async function writeRanges(title: string, updates: Update[]) {
  if (!updates.length) return
  await sheetsApi(SPREADSHEET_ID, '/values:batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data: updates.map((u) => ({ range: a1(title, u.range), values: u.values })) }),
  })
}

/** Status line after handling «Применить»: untick it, leave «Отменить» as the human set it. Row 1 is never written
 *  whole from an earlier read — a checkbox ticked meanwhile would be lost (caught by tests/sheet/live.mjs). */
const statusUpdate = (text: string): Update[] => [{ range: 'A1', values: [[false]] }, { range: 'E1', values: [[text]] }]
/** Server-owned cells of a cabin row: H (note) .. M. Never the visible F/G a human edits. */
const serverCells = (grid: Row[], i: number): Update => ({ range: `H${i + 1}:M${i + 1}`, values: [grid[i].slice(C.note, COLS)] })

function formatRequests(sheetId: number, rowCount: number, existingRules: number) {
  const range = (r0: number, r1: number, c0: number, c1: number) => ({ sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 })
  const rgb = (red: number, green: number, blue: number) => ({ red, green, blue })
  const rule = (ranges: object[], condition: object, color: object) =>
    ({ addConditionalFormatRule: { index: 9999, rule: { ranges, booleanRule: { condition, format: { backgroundColor: color } } } } })
  const formula = (f: string) => ({ type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: f }] })
  const textEq = (t: string) => ({ type: 'TEXT_EQ', values: [{ userEnteredValue: t }] })
  const cabins = [range(2, rowCount, 0, C.note + 1)]
  return [
    ...Array.from({ length: existingRules }, () => ({ deleteConditionalFormatRule: { sheetId, index: 0 } })),
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 2 } }, fields: 'gridProperties.frozenRowCount' } },
    // Reset first: old export tabs carry their own styling and validation
    { repeatCell: { range: range(0, rowCount + 50, 0, 26), cell: { userEnteredFormat: {} }, fields: 'userEnteredFormat' } },
    { setDataValidation: { range: range(0, rowCount + 50, 0, 26) } },
    { repeatCell: { range: range(0, 1, 0, COLS), cell: { userEnteredFormat: { textFormat: { italic: true, foregroundColor: rgb(0.4, 0.4, 0.4) } } }, fields: 'userEnteredFormat.textFormat' } },
    { repeatCell: { range: range(1, 2, 0, COLS), cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: rgb(1, 1, 1) }, backgroundColor: rgb(0.26, 0.52, 0.96) } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
    // Plain text in Статус/Кто живёт: otherwise Sheets turns "1/2" into a date and "+7999…" into a number or formula
    { repeatCell: { range: range(2, rowCount + 50, C.status, C.guests + 1), cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } },
    { setDataValidation: { range: range(0, 1, 0, 1), rule: { condition: { type: 'BOOLEAN' } } } },
    { setDataValidation: { range: range(0, 1, 2, 3), rule: { condition: { type: 'BOOLEAN' } } } },
    { setDataValidation: { range: range(2, rowCount, C.status, C.status + 1), rule: { condition: { type: 'ONE_OF_LIST', values: STATUS_OPTIONS.map((v) => ({ userEnteredValue: v })) }, strict: true, showCustomUi: true } } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: C.hGuests }, properties: { hiddenByUser: false }, fields: 'hiddenByUser' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: C.hGuests, endIndex: COLS }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } },
    { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: C.guests } } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: C.guests, endIndex: C.guests + 1 }, properties: { pixelSize: 420 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: C.note, endIndex: C.note + 1 }, properties: { pixelSize: 260 }, fields: 'pixelSize' } },
    // First matching rule wins: conflict, then "check it", then "not applied yet", then status colours
    rule(cabins, formula('=$H3<>""'), rgb(0.96, 0.7, 0.7)),
    rule(cabins, formula('=AND(ISNUMBER($M3),ISNUMBER($L3),$M3-$L3<60000)'), rgb(1, 0.75, 0.45)),
    rule(cabins, formula('=AND($K3<>"",OR(NOT(EXACT($G3,$I3)),NOT(EXACT($F3,$J3))))'), rgb(1, 0.9, 0.4)),
    rule([range(2, rowCount, C.status, C.status + 1)], textEq('Свободна'), rgb(0.85, 0.94, 0.83)),
    rule([range(2, rowCount, C.status, C.status + 1)], textEq('Половина свободна'), rgb(0.88, 0.93, 1)),
  ]
}

/** Tab has no manual edits (or the human asked to drop them): make it equal to the DB. */
async function writeClean(title: string, getTab: GetTab, grid: Row[], cabins: DbCabin[], now: number, banner?: string): Promise<string> {
  const desired = buildGrid(cabins, grid, banner ?? `Обновляется из базы, ${nowLabel()}. Правьте «Кто живёт» и «Статус», потом отметьте «Применить».`, now)
  const rebuild = !sameShape(grid, desired)
  if (!rebuild) {
    // Only rows that changed: a human typing into another row at this very moment is not overwritten
    const updates: Update[] = []
    desired.forEach((row, i) => {
      if (i >= 2 && !sameRows([[], grid[i]], [[], row])) updates.push({ range: `A${i + 1}:M${i + 1}`, values: [row] })
    })
    const row1 = grid[0] ?? []
    if (updates.length || banner || STALE_BANNER.test(str(row1[4]))) updates.push({ range: 'E1', values: [[desired[0][4]]] })
    if (isTrue(row1[0])) updates.push({ range: 'A1', values: [[false]] })
    if (isTrue(row1[2])) updates.push({ range: 'C1', values: [[false]] })
    if (str(row1[C.seen]) !== '') updates.push({ range: 'M1', values: [['']] })
    if (!updates.length) return `${title}: up to date`
    await writeRanges(title, updates)
    return `${title}: updated ${updates.length} ranges`
  }
  await sheetsApi(SPREADSHEET_ID, `/values/${encodeURIComponent(a1(title, 'A1:Z'))}:clear`, { method: 'POST' })
  await writeRanges(title, [{ range: 'A1', values: desired }])
  {
    const tab = await getTab()
    await sheetsApi(SPREADSHEET_ID, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: formatRequests(tab.sheetId, desired.length, tab.rules) }) })
    tab.rules = 5
  }
  return `${title}: rebuilt`
}

/** "Применить" ticked with dirty rows. Mutates grid's server cells; returns updates to write. */
async function applyEdits(supabase: SupabaseClient, trip: Trip, grid: Row[], dirty: number[], cabins: DbCabin[]): Promise<{ updates: Update[]; result: string }> {
  const labels = (rows: number[]) => rows.map((i) => cabinLabel(grid[i])).join(', ')

  const orange = orangeRows(grid, dirty)
  if (orange.length) {
    orange.forEach((i) => (grid[i][C.seen] = CONFIRMED))
    return {
      updates: [...orange.map((i) => serverCells(grid, i)), ...statusUpdate(`🟧 Каюты ${labels(orange)}: сервер изменил их меньше чем за минуту до вашей правки. Проверьте и отметьте «Применить» ещё раз.`)],
      result: 'confirm',
    }
  }

  const { problem } = buildActions(grid, dirty)
  if (problem) return { updates: statusUpdate(`❌ Не применено: ${problem}.`), result: 'invalid' }

  const touched = new Set<number>()
  const settle = (i: number) => {
    grid[i][C.hGuests] = grid[i][C.guests]
    grid[i][C.hStatus] = grid[i][C.status]
    grid[i][C.note] = ''
    grid[i][C.seen] = ''
    touched.add(i)
  }
  const done = () => ({ updates: [...[...touched].map((i) => serverCells(grid, i)), ...statusUpdate(`✅ Применено ${nowLabel()}: ${labels(dirty)}.`)], result: 'applied' })

  // Second attempt only when every "conflict" was the DB already holding the typed value — e.g. the previous run
  // applied but failed to write the sheet back. Then the rest is applied without bothering the human.
  let rows = dirty
  for (let attempt = 0; attempt < 2 && rows.length; attempt++) {
    const { actions } = buildActions(grid, rows)
    const { data: proposal, error } = await supabase.from('bot_proposals')
      .insert({ chat_id: 0, created_by: 0, summary: `Правка из таблицы: ${trip.name}, каюты ${labels(rows)}`, actions })
      .select('id').single()
    if (error) throw error
    const { data: res, error: applyError } = await supabase.rpc('bot_apply_proposal', { p_id: proposal.id, p_actor: ACTOR })
    if (applyError) throw applyError

    if (res.status === 'applied') {
      rows.forEach(settle)
      return done()
    }
    if (res.status !== 'conflict') throw new Error(`bot_apply_proposal: ${JSON.stringify(res)}`)

    // Show what the DB holds now and take it as the new "was": fixing the visible text and ticking again applies it.
    const byId = new Map(cabins.map((c) => [c.id, c]))
    const real: number[] = []
    for (const conflict of res.conflicts as { cabin_id: string; current_guests: string | null; current_status: string | null }[]) {
      const i = rows.find((d) => str(grid[d][C.id]) === conflict.cabin_id)
      if (i === undefined) continue
      if (!byId.has(conflict.cabin_id) || conflict.current_status === null) {
        grid[i][C.note] = 'каюты больше нет в базе'
      } else if ((conflict.current_guests ?? '') === str(grid[i][C.guests]) && statusLabel(conflict.current_status) === str(grid[i][C.status])) {
        settle(i) // already in the DB exactly as typed
        continue
      } else {
        grid[i][C.hGuests] = conflict.current_guests ?? ''
        grid[i][C.hStatus] = statusLabel(conflict.current_status)
        grid[i][C.note] = `в базе сейчас: ${statusLabel(conflict.current_status)} · ${conflict.current_guests || '—'}`
      }
      real.push(i)
      touched.add(i)
    }
    if (real.length) {
      return {
        updates: [...[...touched].map((i) => serverCells(grid, i)), ...statusUpdate(`❌ Не применено ничего: каюты ${labels(real)} успели измениться в базе (красные). Поправьте их и отметьте «Применить» ещё раз — или «Отменить мои правки».`)],
        result: 'conflict',
      }
    }
    rows = rows.filter((i) => !touched.has(i))
  }
  return done()
}

async function remindAdmins(supabase: SupabaseClient, title: string) {
  const { data: admins } = await supabase.from('admin_users').select('telegram_id')
  for (const a of admins ?? []) {
    try {
      await sendText(Number(a.telegram_id), `В таблице, лист «${title}», уже полчаса висят неприменённые правки — витрина не обновляется. Отметьте «Применить» или «Отменить мои правки».`)
    } catch (err) {
      console.error('remind failed', a.telegram_id, err)
    }
  }
}

async function syncTrip(supabase: SupabaseClient, trip: Trip, grid: Row[], tab: GetTab, now: number): Promise<string> {
  const title = tabTitle(trip)
  const cabins = toDb(trip)
  const a = analyze(grid)

  if (!a.empty && !a.legacy && !a.broken && str(grid[0]?.[1]) === OUR_ROW1_LABEL && str(grid[0]?.[11]) !== FORMAT_VERSION) {
    const t = await tab()
    await sheetsApi(SPREADSHEET_ID, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: formatRequests(t.sheetId, grid.length, t.rules) }) })
    t.rules = 5
    await writeRanges(title, [{ range: 'L1', values: [[FORMAT_VERSION]] }])
  }

  if (a.undo) return writeClean(title, tab, grid, cabins, now, `↩️ Правки отменены, ${nowLabel()}. Лист снова показывает базу.`)
  if (a.broken) {
    const text = `⚠️ Не понимаю таблицу: ${a.broken}. Ничего не применяю. Отметьте «Отменить мои правки» — лист пересоберётся из базы.`
    // Only if row 1 is still ours: after a row was inserted/deleted above, A1/E1 are someone else's cells
    if (str(grid[0]?.[1]) === OUR_ROW1_LABEL && (str(grid[0]?.[4]) !== text || a.apply)) await writeRanges(title, statusUpdate(text))
    return `${title}: broken (${a.broken})`
  }
  if (!a.dirty.length) {
    if (a.apply) return writeClean(title, tab, grid, cabins, now, `ℹ️ Нечего применять: ручных правок нет. ${nowLabel()}`)
    return writeClean(title, tab, grid, cabins, now)
  }

  // Dirty: only server cells and row 1 are written. Remember when each edit was first seen (column M).
  const updates: Update[] = []
  grid.forEach((r, i) => {
    if (i < 2 || !str(r[C.id])) return
    const dirty = a.dirty.includes(i)
    if (dirty && str(r[C.seen]) === '') {
      r[C.seen] = now
      updates.push(serverCells(grid, i))
    } else if (!dirty && (str(r[C.seen]) !== '' || str(r[C.note]) !== '')) {
      r[C.seen] = ''
      r[C.note] = ''
      updates.push(serverCells(grid, i))
    }
  })

  let result: string
  if (a.apply) {
    const applied = await applyEdits(supabase, trip, grid, a.dirty, cabins)
    updates.push(...applied.updates)
    result = applied.result
  } else {
    const pending = pendingChanges(grid, cabins)
    const text = `✏️ Неприменённые правки: ${a.dirty.map((i) => cabinLabel(grid[i])).join(', ')}. Отметьте «Применить» или «Отменить мои правки». Пока правки висят, лист не обновляется из базы` +
      (pending.length ? `; в базе изменились: ${pending.join(', ')} — появятся после.` : '.')
    const firstSeen = Math.min(...a.dirty.map((i) => Number(grid[i][C.seen])).filter((n) => !isNaN(n)))
    let reminded = grid[0]?.[C.seen] ?? ''
    if (str(reminded) === '' && now - firstSeen > REMIND_MS) {
      reminded = now
      await writeRanges(title, [{ range: 'M1', values: [[now]] }]) // recorded before sending: a failed write must not spam
      await remindAdmins(supabase, title)
      grid[0][C.seen] = now
    }
    // Checkboxes untouched. A failed apply (❌/🟧) stays readable until the human ticks again or undoes.
    const lastAttempt = /^(❌|🟧)/.test(str(grid[0]?.[4]))
    if (!lastAttempt && str(grid[0]?.[4]) !== text) updates.push({ range: 'E1', values: [[text]] })
    if (reminded !== (grid[0]?.[C.seen] ?? '')) updates.push({ range: 'M1', values: [[reminded]] })
    result = 'waiting'
  }
  await writeRanges(title, updates)
  return `${title}: dirty ${a.dirty.length} → ${result}`
}

Deno.serve(async (req) => {
  if (req.headers.get('x-sync-secret') !== SYNC_SECRET) return new Response('Forbidden', { status: 403 })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const token = crypto.randomUUID() // only the owner may release: a run that outlived its lease mustn't free a newer run's lock
  const { data: locked, error: lockError } = await supabase.rpc('sheet_sync_try_lock', { p_token: token })
  if (lockError) return Response.json({ ok: false, error: String(lockError.message) }, { status: 500 })
  if (!locked) return Response.json({ ok: true, busy: true }) // another run is on it; the next poll catches up

  try {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
    const { data: trips, error } = await supabase
      .from('trips')
      .select('id, name, start_date, cabins(id, cabin_number, deck, bed_type, price, status, guests, yachts(name))')
      .gte('end_date', since)
      .returns<Trip[]>()
    if (error) throw error

    // Tab metadata costs a read too: fetched only when a tab is missing or gets rebuilt.
    let tabs: Map<string, Tab> | null = null
    const loadTabs = async () => {
      if (!tabs) {
        const meta = await sheetsApi(SPREADSHEET_ID, '?fields=sheets(properties(sheetId,title),conditionalFormats)')
        tabs = new Map(meta.sheets.map((s: any) => [s.properties.title, { sheetId: s.properties.sheetId, rules: s.conditionalFormats?.length ?? 0 }]))
      }
      return tabs
    }
    const titles = (trips ?? []).map(tabTitle)
    let grids: Row[][]
    try {
      grids = await readGrids(titles)
    } catch (err) {
      if (!/Unable to parse range/.test(String(err))) throw err
      const known = await loadTabs()
      for (const title of titles.filter((t) => !known.has(t))) {
        const res = await sheetsApi(SPREADSHEET_ID, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }) })
        known.set(title, { sheetId: res.replies[0].addSheet.properties.sheetId, rules: 0 })
      }
      grids = await readGrids(titles)
    }

    const now = Date.now()
    const results: string[] = []
    for (const [n, trip] of (trips ?? []).entries()) {
      const getTab = async () => {
        const tab = (await loadTabs()).get(titles[n])
        if (!tab) throw new Error(`tab disappeared: ${titles[n]}`)
        return tab
      }
      try {
        results.push(await syncTrip(supabase, trip, grids[n], getTab, now))
      } catch (err) {
        console.error(`sheet-sync ${trip.name}:`, err)
        results.push(`${tabTitle(trip)}: error ${String(err).slice(0, 200)}`)
      }
    }
    return Response.json({ ok: true, results })
  } catch (err) {
    console.error('sheet-sync failed:', err)
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  } finally {
    await supabase.rpc('sheet_sync_release_lock', { p_token: token })
  }
})
