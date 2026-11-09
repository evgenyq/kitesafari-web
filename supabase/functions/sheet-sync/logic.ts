// Pure logic of the sheet tab: layout, what a human changed, what to write back. No I/O here (tested in tests/sheet).
//
// Tab layout (docs/ARCHITECTURE.md, "Правка прямо в Google-таблице"):
//   row 1  — A ☐ «Применить» | B label | C ☐ «Отменить мои правки» | D label | E status line | M hidden: reminder sent at
//   row 2  — headers
//   row 3+ — one row per cabin:
//     A Яхта | B Каюта | C Палуба | D Тип | E Цена | F Статус | G Кто живёт | H Сервер (conflict note)
//     hidden: I guests as last written by the server | J status as last written | K cabin id
//             L when the server last changed this row (ms) | M when the server first saw a human edit here (ms),
//             or CONFIRMED after an "are you sure" round
// A row is "dirty" when visible F/G differ from hidden I/J. While any row is dirty the server never rewrites the
// tab's cells (only row 1 and hidden column M), so manual work is never overwritten.

export type Cell = string | number | boolean
export type Row = Cell[]

export const COLS = 13 // A..M
export const C = { yacht: 0, num: 1, deck: 2, type: 3, price: 4, status: 5, guests: 6, note: 7, hGuests: 8, hStatus: 9, id: 10, written: 11, seen: 12 } as const
export const HEADERS = ['Яхта', 'Каюта', 'Палуба', 'Тип', 'Цена (€)', 'Статус', 'Кто живёт', 'Сервер', '_гости', '_статус', '_id', '_записано', '_замечено']
const LEGACY_HEADERS = ['Яхта', 'Каюта', 'Палуба', 'Тип', 'Цена (€)', 'Статус', 'Кто живёт', '_гости', '_статус', '_id'] // migration 010 layout
export const CONFIRMED = 'проверено'
export const ORANGE_MS = 60_000 // server changed the row less than this before the edit appeared → ask to confirm
export const REMIND_MS = 30 * 60_000

export const STATUS_LABELS: Record<string, string> = {
  'Available': 'Свободна',
  'Half Available': 'Половина свободна',
  'Booked': 'Занята',
  'Paid': 'Оплачена',
  'Unavailable': 'Недоступна',
  'STAFF': 'STAFF',
}
export const STATUS_OPTIONS = Object.values(STATUS_LABELS)
export const statusLabel = (code: string) => STATUS_LABELS[code] ?? code
/** Label back to DB code; unknown text passes through (a legacy DB value shown as-is maps back to itself). */
export const statusCode = (label: string) => Object.entries(STATUS_LABELS).find(([, l]) => l === label)?.[0] ?? label

export const str = (v: Cell | undefined | null) => (v === undefined || v === null ? '' : String(v))
export const pad = (row: Row = []): Row => Array.from({ length: COLS }, (_, i) => row[i] ?? '')
const num = (v: Cell | undefined) => (typeof v === 'number' ? v : str(v) !== '' && !isNaN(Number(v)) ? Number(v) : null)
const isTrue = (v: Cell | undefined) => v === true || str(v).toUpperCase() === 'TRUE'

export interface DbCabin {
  id: string
  yacht: string
  num: string
  deck: string
  type: string
  price: string
  status: string // DB code
  guests: string
}

export const cabinLabel = (r: Row) => `${str(r[C.yacht])} ${str(r[C.num])}`.trim()

export const isDirty = (r: Row) =>
  str(r[C.id]) !== '' && (str(r[C.guests]) !== str(r[C.hGuests]) || str(r[C.status]) !== str(r[C.hStatus]))

export interface Analysis {
  empty: boolean
  legacy: boolean // migration-010 layout, safe to rebuild when not dirty
  broken: string | null // why the tab can't be understood (human changed headers, duplicated rows)
  apply: boolean
  undo: boolean
  dirty: number[] // grid indexes (0-based) of dirty cabin rows
}

export function analyze(grid: Row[]): Analysis {
  const header = (grid[1] ?? []).map(str)
  const empty = grid.every((r) => r.every((v) => str(v) === ''))
  const legacy = LEGACY_HEADERS.every((h, i) => header[i] === h) && header.slice(LEGACY_HEADERS.length).every((h) => h === '')
  const headerOk = HEADERS.every((h, i) => header[i] === h)
  const apply = isTrue(grid[0]?.[0])
  const undo = isTrue(grid[0]?.[2])

  let broken: string | null = null
  const dirty: number[] = []
  if (!empty && !legacy && !headerOk) broken = 'изменены заголовки (вторая строка)'
  if (headerOk) {
    const seen = new Set<string>()
    grid.forEach((r, i) => {
      if (i < 2) return
      const id = str(r[C.id])
      if (!id) return
      if (seen.has(id)) broken = `каюта ${cabinLabel(r)} встречается дважды`
      seen.add(id)
      if (isDirty(r)) dirty.push(i)
    })
  }
  return { empty, legacy, broken, apply, undo, dirty }
}

/** Desired tab content from the DB. Keeps each row's "server changed it at" (L) if the row's data didn't change. */
export function buildGrid(cabins: DbCabin[], current: Row[], banner: string, now: number): Row[] {
  const prev = new Map<string, Row>()
  current.slice(2).forEach((r) => str(r[C.id]) && prev.set(str(r[C.id]), r))
  const rows = [...cabins]
    .sort((a, b) => a.yacht.localeCompare(b.yacht) || (parseInt(a.num) || 0) - (parseInt(b.num) || 0) || a.num.localeCompare(b.num) || a.id.localeCompare(b.id))
    .map((c) => {
      const status = statusLabel(c.status)
      const data: Row = [c.yacht, c.num, c.deck, c.type, c.price, status, c.guests, '', c.guests, status, c.id]
      const old = prev.get(c.id)
      const same = old && data.every((v, i) => i === C.note || str(v) === str(old[i]))
      return pad([...data, same && num(old![C.written]) !== null ? num(old![C.written])! : now, ''])
    })
  return [headerRow(banner), pad(HEADERS), ...rows]
}

/** Bump when formatRequests change: tabs with another version get re-formatted (values untouched). Stored in hidden L1. */
export const FORMAT_VERSION = 'format-2'
export const OUR_ROW1_LABEL = '← Применить'
export const headerRow = (banner: string, reminded: Cell = ''): Row =>
  pad([false, OUR_ROW1_LABEL, false, '← Отменить мои правки', banner, '', '', '', '', '', '', FORMAT_VERSION, reminded])

/** Cabin rows equal (all columns, row 1 excluded). */
export const sameRows = (a: Row[], b: Row[]) =>
  a.length === b.length && a.every((r, i) => i === 0 || pad(r).every((v, j) => str(v) === str(b[i][j])))

/** Same cabins in the same order under the expected header — otherwise rebuild (with formatting). */
export function sameShape(current: Row[], desired: Row[]): boolean {
  if (current.length < 2 || !HEADERS.every((h, i) => str(current[1][i]) === h)) return false
  const ids = (g: Row[]) => g.slice(2).map((r) => str(r[C.id])).join('|')
  return ids(current) === ids(desired)
}

/** Dirty rows the server changed less than ORANGE_MS before the edit was first seen, and not yet confirmed. */
export function orangeRows(grid: Row[], dirty: number[]): number[] {
  return dirty.filter((i) => {
    const seen = num(grid[i][C.seen])
    const written = num(grid[i][C.written])
    return seen !== null && written !== null && seen - written < ORANGE_MS
  })
}

export interface Action {
  type: 'cabin'
  cabin_id: string
  expected_guests: string
  expected_status: string
  new_guests: string
  new_status: string
}

/** Proposal actions for the dirty rows, or the problem that blocks applying. */
export function buildActions(grid: Row[], dirty: number[]): { actions: Action[]; problem: string | null } {
  const bad = dirty.filter((i) => str(grid[i][C.status]) !== str(grid[i][C.hStatus]) && !STATUS_OPTIONS.includes(str(grid[i][C.status])))
  if (bad.length) {
    return { actions: [], problem: `непонятный статус в каютах ${bad.map((i) => cabinLabel(grid[i])).join(', ')} — выберите из списка` }
  }
  const actions = dirty.map((i) => ({
    type: 'cabin' as const,
    cabin_id: str(grid[i][C.id]),
    expected_guests: str(grid[i][C.hGuests]),
    expected_status: statusCode(str(grid[i][C.hStatus])),
    new_guests: str(grid[i][C.guests]),
    new_status: statusCode(str(grid[i][C.status])),
  }))
  return { actions, problem: null }
}

/** DB changes not shown yet because the tab is held by manual edits (compared to what the server last wrote). */
export function pendingChanges(grid: Row[], cabins: DbCabin[]): string[] {
  const byId = new Map(cabins.map((c) => [c.id, c]))
  const out: string[] = []
  grid.slice(2).forEach((r) => {
    const c = byId.get(str(r[C.id]))
    if (!c) return
    if ((c.guests ?? '') !== str(r[C.hGuests]) || statusLabel(c.status) !== str(r[C.hStatus])) out.push(cabinLabel(r))
  })
  return out
}
