// Unit tests for the sheet tab logic (supabase/functions/sheet-sync/logic.ts).
// Run: node --test tests/sheet/logic.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  analyze, buildActions, buildGrid, C, CONFIRMED, HEADERS, orangeRows, pad, pendingChanges, sameRows, sameShape,
} from '../../supabase/functions/sheet-sync/logic.ts'
import type { DbCabin, Row } from '../../supabase/functions/sheet-sync/logic.ts'

const cab = (id: string, num: string, status = 'Available', guests = ''): DbCabin =>
  ({ id, yacht: 'Lyra', num, deck: 'Main Deck', type: 'Twin', price: '3400', status, guests })
const DB = [cab('a', '1', 'Booked', 'Аня'), cab('b', '2'), cab('c', '10', 'Paid', 'Слава')]
const T0 = 1_000_000

const fresh = () => buildGrid(DB, [], 'banner', T0)
const edit = (g: Row[], i: number, col: number, v: string) => { g[i] = [...g[i]]; g[i][col] = v; return g }

test('fresh grid: header, rows sorted numerically, hidden copies, written time', () => {
  const g = fresh()
  assert.deepEqual(g[1], HEADERS)
  assert.deepEqual(g.slice(2).map((r) => r[C.num]), ['1', '2', '10'])
  assert.equal(g[2][C.status], 'Занята')
  assert.equal(g[2][C.hStatus], 'Занята')
  assert.equal(g[2][C.hGuests], 'Аня')
  assert.equal(g[2][C.written], T0)
  const a = analyze(g)
  assert.deepEqual([a.broken, a.dirty, a.apply, a.undo, a.empty], [null, [], false, false, false])
})

test('rebuild keeps "written" time for unchanged rows, bumps changed ones', () => {
  const db2 = [DB[0], cab('b', '2', 'Booked', 'Петя'), DB[2]]
  const g = buildGrid(db2, fresh(), 'x', T0 + 5000)
  assert.equal(g[2][C.written], T0)
  assert.equal(g[3][C.written], T0 + 5000)
  assert.ok(sameShape(fresh(), g))
  assert.ok(!sameRows(fresh(), g))
  assert.ok(sameRows(fresh(), buildGrid(DB, fresh(), 'other banner', T0 + 9000))) // banner/time alone don't count
})

test('dirty rows: guests or status changed; case-only change counts', () => {
  const g = edit(edit(fresh(), 2, C.guests, 'аня'), 3, C.status, 'Занята')
  assert.deepEqual(analyze(g).dirty, [2, 3])
})

test('checkboxes read as booleans or TRUE text', () => {
  const g = fresh(); g[0] = [...g[0]]; g[0][0] = true; g[0][2] = 'TRUE'
  const a = analyze(g)
  assert.ok(a.apply && a.undo)
})

test('broken: headers changed or a row duplicated; empty and legacy tabs are fine', () => {
  const h = fresh(); h[1] = [...h[1]]; h[1][6] = 'Гости'
  assert.match(analyze(h).broken!, /заголовки/)
  const d = fresh(); d.push([...d[2]])
  assert.match(analyze(d).broken!, /дважды/)
  assert.equal(analyze([]).broken, null)
  assert.ok(analyze([]).empty)
  const legacy = [pad(['old banner']), pad(['Яхта', 'Каюта', 'Палуба', 'Тип', 'Цена (€)', 'Статус', 'Кто живёт', '_гости', '_статус', '_id'])]
  assert.deepEqual([analyze(legacy).legacy, analyze(legacy).broken], [true, null])
})

test('actions: expected = what the server wrote, new = what the human typed, labels → codes', () => {
  const g = edit(edit(fresh(), 3, C.guests, 'Петя'), 3, C.status, 'Занята')
  const { actions, problem } = buildActions(g, [3])
  assert.equal(problem, null)
  assert.deepEqual(actions, [{ type: 'cabin', cabin_id: 'b', expected_guests: '', expected_status: 'Available', new_guests: 'Петя', new_status: 'Booked' }])
})

test('swap of two cabins becomes one all-or-nothing batch', () => {
  const g = edit(edit(fresh(), 2, C.guests, 'Слава'), 4, C.guests, 'Аня')
  const { actions } = buildActions(g, analyze(g).dirty)
  assert.deepEqual(actions.map((a) => [a.cabin_id, a.expected_guests, a.new_guests]), [['a', 'Аня', 'Слава'], ['c', 'Слава', 'Аня']])
})

test('unknown status text blocks applying', () => {
  const g = edit(fresh(), 3, C.status, 'забронирована')
  assert.match(buildActions(g, [3]).problem!, /непонятный статус.*Lyra 2/)
})

test('orange: edit first seen < 1 min after the server changed the row; confirmed rows pass', () => {
  const g = edit(fresh(), 2, C.guests, 'Аня Морозова')
  g[2][C.seen] = T0 + 30_000
  assert.deepEqual(orangeRows(g, [2]), [2])
  g[2][C.seen] = T0 + 61_000
  assert.deepEqual(orangeRows(g, [2]), [])
  g[2][C.seen] = CONFIRMED
  assert.deepEqual(orangeRows(g, [2]), [])
})

test('pending DB changes are listed against what the server last wrote', () => {
  const g = fresh()
  assert.deepEqual(pendingChanges(g, DB), [])
  assert.deepEqual(pendingChanges(g, [DB[0], cab('b', '2', 'Booked', 'Петя'), DB[2]]), ['Lyra 2'])
})
