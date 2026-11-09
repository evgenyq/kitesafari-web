// Live scenarios for editing from the Google Sheet: real sheet-sync on prod, the past autumn-2026 tab only.
// Acts like a human (writes cells via the Sheets API) and like the bot (writes the DB), waits for the server.
// Touched cabins are restored at the end.  Run: tests/sheet/run.sh
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'

const SUPA = 'https://zmbiiywazaytltemzzvc.supabase.co'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const env = fs.readFileSync(os.homedir() + '/Projects/kitesafaribot/.env', 'utf8')
const SHEET = env.match(/^GOOGLE_SHEETS_ID=(.*)$/m)[1].trim().replace(/^['"]|['"]$/g, '')
const CREDS = JSON.parse(fs.readFileSync(os.homedir() + '/Projects/kitesafaribot/google_credentials.json', 'utf8'))
const TAB = 'Осеннее кайт-сафари 2026 (2026-10-10)'
const C = { status: 5, guests: 6, note: 7, hGuests: 8, hStatus: 9, id: 10, written: 11, seen: 12 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- Google ----------
let token
async function gtoken() {
  if (token) return token
  const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: CREDS.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), CREDS.private_key).toString('base64url')
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }) })
  token = (await r.json()).access_token
  return token
}
async function sheets(path, init = {}) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}${path}`, { ...init, headers: { Authorization: `Bearer ${await gtoken()}`, 'Content-Type': 'application/json' } })
  if (!r.ok) throw new Error(`Sheets ${r.status}: ${await r.text()}`)
  return r.json()
}
const rng = (r) => encodeURIComponent(`'${TAB}'!${r}`)
const readGrid = async () => (await sheets(`/values/${rng('A1:M')}?valueRenderOption=UNFORMATTED_VALUE`)).values ?? []
const setCell = (cell, value) => sheets(`/values/${rng(cell)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [[value]] }) })

// ---------- DB (service role, PostgREST) ----------
async function db(path, init = {}) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' } })
  if (!r.ok) throw new Error(`DB ${r.status}: ${await r.text()}`)
  return r.json()
}
const getCabin = async (id) => (await db(`cabins?id=eq.${id}&select=id,guests,status`))[0]
const setCabin = (id, patch) => db(`cabins?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ ...patch, changed_by: 'тест таблицы' }) })

// ---------- helpers ----------
const rowOf = (grid, id) => grid.findIndex((r) => r[C.id] === id)
const banner = (grid) => String(grid[0]?.[4] ?? '')
async function waitFor(what, pred, timeoutMs = 45_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const g = await readGrid()
    if (pred(g)) return { grid: g, ms: Date.now() - t0 }
    await sleep(5000) // Google: 60 reads a minute shared with the server
  }
  throw new Error(`timeout waiting for: ${what}; banner: ${banner(await readGrid())}`)
}
const results = []
async function scenario(name, fn) {
  try {
    const info = await fn()
    results.push(`✅ ${name}${info ? ` — ${info}` : ''}`)
  } catch (err) {
    results.push(`❌ ${name}: ${err.message}`)
  }
  console.log(results.at(-1))
}

// ---------- run ----------
const grid0 = await readGrid()
const legacy = grid0.filter((r, i) => i >= 2 && r[0] === 'Legacy' && ['3', '4', '5', '6'].includes(String(r[1])))
if (legacy.length !== 4) throw new Error('expected Legacy 3–6 on the autumn tab')
const [c3, c4, c5, c6] = legacy.map((r) => r[C.id])
const originals = await Promise.all([c3, c4, c5, c6].map(getCabin))
const A1 = (grid, id) => rowOf(grid, id) + 1 // sheet row number

// Rows the server changed < 1 min ago need a second tick ("orange") — start only when the test rows are older
const lastWritten = Math.max(...legacy.map((r) => Number(r[C.written]) || 0))
const settle = lastWritten + 65_000 - Date.now()
if (settle > 0) {
  console.log(`жду ${Math.ceil(settle / 1000)} с, пока тестовые каюты «остынут»`)
  await sleep(settle)
}

try {
  await scenario('правка видна как неприменённая (жёлтая), сервер не трогает лист', async () => {
    await setCell(`G${A1(grid0, c3)}`, 'ТЕСТ Аня')
    const { grid, ms } = await waitFor('✏️ banner', (g) => banner(g).startsWith('✏️'))
    if (typeof grid[rowOf(grid, c3)][C.seen] !== 'number') throw new Error('M not set')
    return `заметил за ${(ms / 1000).toFixed(1)} с`
  })

  await scenario('«Применить» пишет в базу', async () => {
    await setCell('A1', true)
    const { ms } = await waitFor('✅ banner', (g) => banner(g).startsWith('✅'))
    const c = await getCabin(c3)
    if (c.guests !== 'ТЕСТ Аня') throw new Error(`DB guests = ${c.guests}`)
    return `применено за ${(ms / 1000).toFixed(1)} с после галочки`
  })

  await scenario('конфликт: бот поменял каюту, пока в таблице правка → ничего не применено, красная строка', async () => {
    let g = await readGrid()
    await setCell(`G${A1(g, c4)}`, 'ТЕСТ из таблицы')
    await waitFor('✏️', (x) => banner(x).startsWith('✏️'))
    await setCabin(c4, { guests: 'ТЕСТ из бота' })
    await setCell('A1', true)
    ;({ grid: g } = await waitFor('❌ banner', (x) => banner(x).startsWith('❌')))
    const note = String(g[rowOf(g, c4)][C.note])
    if (!note.includes('ТЕСТ из бота')) throw new Error(`note = ${note}`)
    if ((await getCabin(c4)).guests !== 'ТЕСТ из бота') throw new Error('DB overwritten')
    // fix the text and apply again → goes through against the new "was"
    await setCell(`G${A1(g, c4)}`, 'ТЕСТ из бота + из таблицы')
    await setCell('A1', true)
    await waitFor('✅', (x) => banner(x).startsWith('✅'))
    if ((await getCabin(c4)).guests !== 'ТЕСТ из бота + из таблицы') throw new Error('second apply failed')
    return 'после исправления применилось со второй галочки'
  })

  await scenario('обмен двух кают — одной пачкой', async () => {
    const g = await readGrid()
    const g5 = String(g[rowOf(g, c5)][C.guests]), g6 = String(g[rowOf(g, c6)][C.guests])
    await setCell(`G${A1(g, c5)}`, g6)
    await setCell(`G${A1(g, c6)}`, g5)
    await setCell('A1', true)
    await waitFor('✅', (x) => banner(x).startsWith('✅') && banner(x).includes('Legacy 5') && banner(x).includes('Legacy 6'))
    const [d5, d6] = [await getCabin(c5), await getCabin(c6)]
    if ((d5.guests ?? '') !== g6 || (d6.guests ?? '') !== g5) throw new Error('swap not applied')
  })

  await scenario('оранжевая: правка в каюту, которую сервер только что обновил → нужна вторая галочка', async () => {
    await setCabin(c3, { guests: 'ТЕСТ свежее из бота' })
    let { grid: g } = await waitFor('row refreshed', (x) => String(x[rowOf(x, c3)]?.[C.guests]) === 'ТЕСТ свежее из бота')
    await setCell(`G${A1(g, c3)}`, 'ТЕСТ правка поверх')
    await waitFor('✏️', (x) => banner(x).startsWith('✏️'))
    await setCell('A1', true)
    await waitFor('🟧', (x) => banner(x).startsWith('🟧'))
    if ((await getCabin(c3)).guests !== 'ТЕСТ свежее из бота') throw new Error('applied without confirmation')
    await setCell('A1', true)
    await waitFor('✅', (x) => banner(x).startsWith('✅'))
    if ((await getCabin(c3)).guests !== 'ТЕСТ правка поверх') throw new Error('not applied after confirmation')
  })

  await scenario('непонятный статус блокирует применение', async () => {
    const g = await readGrid()
    await setCell(`F${A1(g, c4)}`, 'забронирована')
    await setCell('A1', true)
    await waitFor('❌ статус', (x) => banner(x).includes('непонятный статус'))
    if ((await getCabin(c4)).status !== originals[1].status) throw new Error('status changed')
  })

  await scenario('«Отменить мои правки» возвращает лист к базе', async () => {
    const g = await readGrid()
    await setCell(`G${A1(g, c5)}`, 'ТЕСТ отменяемая правка')
    await setCell('C1', true)
    const { grid } = await waitFor('↩️', (x) => banner(x).startsWith('↩️'))
    const r4 = grid[rowOf(grid, c4)], r5 = grid[rowOf(grid, c5)]
    if (r4[C.status] !== r4[C.hStatus] || r5[C.guests] === 'ТЕСТ отменяемая правка') throw new Error('not reverted')
  })

  await scenario('изменение в базе без правок доходит до листа', async () => {
    await setCabin(c6, { guests: 'ТЕСТ витрина' })
    const { ms } = await waitFor('row updated', (x) => String(x[rowOf(x, c6)]?.[C.guests]) === 'ТЕСТ витрина')
    return `за ${(ms / 1000).toFixed(1)} с`
  })
} finally {
  for (const o of originals) await setCabin(o.id, { guests: o.guests, status: o.status })
  const ok = await waitFor('restored', (x) => originals.every((o) => String(x[rowOf(x, o.id)]?.[C.guests] ?? '') === (o.guests ?? '')), 60_000).then(() => true, () => false)
  console.log(ok ? 'восстановлено' : '⚠️ лист не вернулся к исходному виду — проверь вручную')
  console.log('\n' + results.join('\n'))
}
