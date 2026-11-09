// Tour setup through the bot (plan step 6): new trip, yachts, cabins, prices, photos — one card, applied
// all-or-nothing by bot_apply_proposal (migration 016). New rows get their ids here, so cabins can point at a
// trip or yacht created by the same card. Everything invalid comes back to the model as an error to fix.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { escapeHtml } from '../_shared/telegram.ts'
import { sendCard, STATUSES, STATUS_RU } from './proposals.ts'

// The Mini App decides by exact words: "Double" = no half booking; decks sort Lower → Sun
export const BED_TYPES = ['Double', 'Twin', 'Double/Twin', 'Single', 'Double + Single'] as const
export const DECKS = ['Lower Deck', 'Main Deck', 'Upper Deck', 'Sun Deck'] as const
export const PHOTO_PREFIX = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/yacht-photos/inbox/`
export const TRIP_STATUSES = ['Booking Open', 'Closed'] as const // only 'Booking Open' is visible in the Mini App (RLS)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ACCESS_CODE = /^[a-z0-9-]{4,40}$/
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

type N<T> = T | null
export interface SetupInput {
  summary: string
  new_trip: N<{ name: string; start_date: string; end_date: string; access_code: N<string>; description: N<string> }>
  trip_updates: { trip_id: string; name: N<string>; start_date: N<string>; end_date: N<string>; access_code: N<string>; description: N<string>; status: N<string> }[]
  new_yachts: { name: string; description: N<string> }[]
  yacht_updates: { yacht_id: string; name: N<string>; description: N<string> }[]
  add_cabins: { trip: string; yacht: string; cabin_number: string; deck: string; bed_type: string; price: number; max_guests: number; status: string }[]
  cabin_updates: { cabin_id: string; cabin_number: N<string>; deck: N<string>; bed_type: N<string>; price: N<number>; max_guests: N<number> }[]
  delete_cabins: string[]
  photos: { url: string; yacht: string; kind: 'photo' | 'deck_plan' }[]
}

const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] })
const str = { type: 'string' }
export const SETUP_TOOL = {
  type: 'function',
  strict: true,
  name: 'propose_setup',
  description: 'Заведение и настройка тура: новый тур, лодки, каюты, цены, фото. Как propose — карточка с Ок/Отмена, всё вместе или ничего. ' +
    'Ссылки внутри одной карточки: trip = id тура или "new" (тур из new_trip); yacht = id лодки или ТОЧНОЕ имя лодки из new_yachts. ' +
    `deck — одно из: ${DECKS.join(', ')}. bed_type — одно из: ${BED_TYPES.join(', ')} (особенности вроде джакузи/сьюта — в описание лодки, не в bed_type). ` +
    'price — за ВСЮ каюту в евро (за место × мест), у STAFF — 0. status новых кают — обычно Available, у кают команды/инструкторов — STAFF. ' +
    'Пустые массивы и null — «не трогать». Фото — только url из сообщений «[Фото …]»; kind=deck_plan для плана палуб. Удалить можно только пустую незабронированную каюту. ' +
    'Новая карточка отменяет прежнюю неподтверждённую: большой тур — одной карточкой, либо по очереди, дожидаясь «Ок» (тогда тур уже есть в контексте с id). ' +
    'Смена access_code ломает уже разосланные ссылки, status Closed прячет тур из приложения — только по прямой просьбе организатора.',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Коротко: «Тур май 2027», «Цены лодки 2», «Фото Sea Treasure»' },
      new_trip: nullable({
        type: 'object',
        properties: {
          name: str, start_date: { type: 'string', description: 'YYYY-MM-DD' }, end_date: { type: 'string', description: 'YYYY-MM-DD' },
          access_code: nullable({ type: 'string', description: 'Код приватной ссылки, латиница/цифры/дефис; null — сгенерировать вида 01-08may2027' }),
          description: nullable(str),
        },
        required: ['name', 'start_date', 'end_date', 'access_code', 'description'],
        additionalProperties: false,
      }),
      trip_updates: {
        type: 'array',
        items: {
          type: 'object',
          properties: { trip_id: str, name: nullable(str), start_date: nullable(str), end_date: nullable(str), access_code: nullable(str), description: nullable(str), status: nullable({ type: 'string', enum: [...TRIP_STATUSES] }) },
          required: ['trip_id', 'name', 'start_date', 'end_date', 'access_code', 'description', 'status'],
          additionalProperties: false,
        },
      },
      new_yachts: {
        type: 'array',
        items: { type: 'object', properties: { name: str, description: nullable(str) }, required: ['name', 'description'], additionalProperties: false },
      },
      yacht_updates: {
        type: 'array',
        items: { type: 'object', properties: { yacht_id: str, name: nullable(str), description: nullable(str) }, required: ['yacht_id', 'name', 'description'], additionalProperties: false },
      },
      add_cabins: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            trip: str, yacht: str, cabin_number: str, deck: { type: 'string', enum: [...DECKS] }, bed_type: { type: 'string', enum: [...BED_TYPES] },
            price: { type: 'number' }, max_guests: { type: 'integer' }, status: { type: 'string', enum: [...STATUSES] },
          },
          required: ['trip', 'yacht', 'cabin_number', 'deck', 'bed_type', 'price', 'max_guests', 'status'],
          additionalProperties: false,
        },
      },
      cabin_updates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            cabin_id: str, cabin_number: nullable(str), deck: nullable({ type: 'string', enum: [...DECKS] }), bed_type: nullable({ type: 'string', enum: [...BED_TYPES] }),
            price: nullable({ type: 'number' }), max_guests: nullable({ type: 'integer' }),
          },
          required: ['cabin_id', 'cabin_number', 'deck', 'bed_type', 'price', 'max_guests'],
          additionalProperties: false,
        },
      },
      delete_cabins: { type: 'array', items: str },
      photos: {
        type: 'array',
        items: { type: 'object', properties: { url: str, yacht: str, kind: { type: 'string', enum: ['photo', 'deck_plan'] } }, required: ['url', 'yacht', 'kind'], additionalProperties: false },
      },
    },
    required: ['summary', 'new_trip', 'trip_updates', 'new_yachts', 'yacht_updates', 'add_cabins', 'cabin_updates', 'delete_cabins', 'photos'],
    additionalProperties: false,
  },
}

/** 2027-05-01..2027-05-08 → 01-08may2027 (the format of recent trips). */
export function accessCodeFor(start: string, end: string): string {
  const [y, m, d] = start.split('-')
  const [, m2, d2] = end.split('-')
  return m === m2 ? `${d}-${d2}${MONTHS[+m - 1].slice(0, 3)}${y}` : `${d}${MONTHS[+m - 1].slice(0, 3)}-${d2}${MONTHS[+m2 - 1].slice(0, 3)}${y}`
}

/** Exact words only: the Mini App sorts decks and allows half bookings by them. */
function badEnum(c: { deck?: string | null; bed_type?: string | null; status?: string | null }): string | null {
  if (c.deck && !(DECKS as readonly string[]).includes(c.deck)) return `палуба «${c.deck}» — только ${DECKS.join(', ')}.`
  if (c.bed_type && !(BED_TYPES as readonly string[]).includes(c.bed_type)) return `кровать «${c.bed_type}» — только ${BED_TYPES.join(', ')} (особенности — в описание лодки).`
  if (c.status && !(STATUSES as readonly string[]).includes(c.status)) return `статус «${c.status}» — только ${STATUSES.join(', ')}.`
  return null
}

const e = escapeHtml
/** A real calendar date (V8 accepts 2027-02-30). */
const realDate = (v: string) => DATE.test(v) && !isNaN(Date.parse(v)) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v
const OPEN_FOR_DELETE = ['Available', 'Unavailable', 'STAFF']
const blank = (s: N<string> | undefined) => (s && s.trim() ? s.trim() : null)
const money = (n: number | string | null) => (n === null || n === '' ? '?' : `${Number(n)}€`)

export async function createSetupProposal(db: SupabaseClient, chatId: number, adminId: number, input: SetupInput): Promise<{ text: string; cardSent: boolean; cardPlain?: string }> {
  const fail = (text: string) => ({ text: `Ошибка: ${text} Карточка не отправлена — исправь и предложи заново.`, cardSent: false })
  const lines: string[] = [`<b>${e(input.summary)}</b>`, '']
  const yachtActions: Record<string, unknown>[] = []
  const tripActions: Record<string, unknown>[] = []
  const cabinActions: Record<string, unknown>[] = []
  const photoActions: Record<string, unknown>[] = []

  const ids = [
    ...input.trip_updates.map((t) => t.trip_id), ...input.yacht_updates.map((y) => y.yacht_id),
    ...input.cabin_updates.map((c) => c.cabin_id), ...input.delete_cabins,
  ]
  if (ids.some((id) => !UUID.test(id))) return fail('id тура/лодки/каюты должны быть из контекста.')

  const [{ data: yachts, error: ye }, { data: trips, error: te }] = await Promise.all([
    db.from('yachts').select('id, name, description'),
    db.from('trips').select('id, name, start_date, end_date, access_code, description, status'),
  ])
  if (ye || te) throw ye ?? te
  const yachtById = new Map((yachts ?? []).map((y) => [y.id, y]))
  const tripById = new Map((trips ?? []).map((t) => [t.id, t]))

  // Yachts
  const newYachtId = new Map<string, string>() // exact name → new id
  for (const y of input.new_yachts) {
    const name = blank(y.name)
    if (!name) return fail('у новой лодки нет имени.')
    if ((yachts ?? []).some((x) => x.name.toLowerCase() === name.toLowerCase()) || newYachtId.has(name)) return fail(`лодка «${name}» уже есть — используй её id.`)
    const id = crypto.randomUUID()
    newYachtId.set(name, id)
    yachtActions.push({ type: 'create_yacht', id, name, description: blank(y.description) ?? '' })
    lines.push(`🛥 Новая лодка: <b>${e(name)}</b>${blank(y.description) ? `\n${e(blank(y.description)!)}` : ''}`, '')
  }
  for (const u of input.yacht_updates) {
    const y = yachtById.get(u.yacht_id)
    if (!y) return fail(`лодки ${u.yacht_id} нет.`)
    const set: Record<string, string> = {}
    const expected: Record<string, string | null> = {}
    const name = blank(u.name)
    if (name && name !== y.name && (yachts ?? []).some((x) => x.id !== y.id && x.name.toLowerCase() === name.toLowerCase())) return fail(`лодка «${name}» уже есть.`)
    if (name && name !== y.name) { set.name = name; expected.name = y.name; lines.push(`🛥 ${e(y.name)}: название → <b>${e(name)}</b>`) }
    if (u.description !== null && (u.description ?? '').trim() !== (y.description ?? '')) {
      set.description = (u.description ?? '').trim(); expected.description = y.description
      lines.push(`🛥 ${e(y.name)}: описание`, `было: ${e(y.description ?? 'пусто')}`, `станет: ${e(set.description || 'пусто')}`)
    }
    if (Object.keys(set).length) { yachtActions.push({ type: 'update_yacht', yacht_id: y.id, set, expected }); lines.push('') }
  }
  const yachtRef = (ref: string): { id: string; name: string } | null => {
    if (UUID.test(ref)) { const y = yachtById.get(ref); return y ? { id: y.id, name: y.name } : null }
    const id = newYachtId.get(ref.trim())
    return id ? { id, name: ref.trim() } : null
  }

  // Trip
  let newTripId: string | null = null
  if (input.new_trip) {
    const t = input.new_trip
    const name = blank(t.name)
    if (!name) return fail('у тура нет названия.')
    if (!realDate(t.start_date) || !realDate(t.end_date)) return fail('даты тура — настоящие даты в формате YYYY-MM-DD.')
    if (t.end_date < t.start_date) return fail('тур заканчивается раньше, чем начинается.')
    const code = blank(t.access_code) ?? accessCodeFor(t.start_date, t.end_date)
    if (!ACCESS_CODE.test(code)) return fail(`код ссылки «${code}» — только латиница, цифры, дефис.`)
    if ((trips ?? []).some((x) => x.access_code === code)) return fail(`код ссылки «${code}» уже занят — придумай другой.`)
    newTripId = crypto.randomUUID()
    tripActions.push({ type: 'create_trip', id: newTripId, name, start_date: t.start_date, end_date: t.end_date, access_code: code, description: blank(t.description) ?? '' })
    lines.push(`🗓 Новый тур: <b>${e(name)}</b>, ${t.start_date} — ${t.end_date}`, `ссылка: ${e(code)}`)
    if (blank(t.description)) lines.push(e(blank(t.description)!))
    lines.push('')
  }
  for (const u of input.trip_updates) {
    const t = tripById.get(u.trip_id)
    if (!t) return fail(`тура ${u.trip_id} нет.`)
    const set: Record<string, string> = {}
    const expected: Record<string, string | null> = {}
    for (const k of ['name', 'start_date', 'end_date', 'access_code', 'status'] as const) {
      const v = blank(u[k])
      if (!v || v === (t as any)[k]) continue
      if ((k === 'start_date' || k === 'end_date') && !realDate(v)) return fail(`${k} — настоящая дата в формате YYYY-MM-DD.`)
      if (k === 'access_code' && (!ACCESS_CODE.test(v) || (trips ?? []).some((x) => x.access_code === v))) return fail(`код ссылки «${v}» не подходит или занят.`)
      if (k === 'status' && !(TRIP_STATUSES as readonly string[]).includes(v)) return fail(`статус тура — только ${TRIP_STATUSES.join(', ')}.`)
      set[k] = v; expected[k] = (t as any)[k]
      const warn = k === 'access_code' ? ' ⚠️ старая ссылка перестанет работать у всех, кому её отправили'
        : k === 'status' && v !== 'Booking Open' ? ' ⚠️ тур пропадёт из приложения' : ''
      lines.push(`🗓 ${e(t.name)}: ${k} ${e(String((t as any)[k] ?? 'пусто'))} → <b>${e(v)}</b>${warn}`)
    }
    if (u.description !== null && (u.description ?? '').trim() !== (t.description ?? '')) {
      set.description = (u.description ?? '').trim(); expected.description = t.description
      lines.push(`🗓 ${e(t.name)}: описание → ${e(set.description || 'пусто')}`)
    }
    const start = set.start_date ?? t.start_date, end = set.end_date ?? t.end_date
    if (start && end && end < start) return fail('тур заканчивается раньше, чем начинается.')
    if (Object.keys(set).length) { tripActions.push({ type: 'update_trip', trip_id: t.id, set, expected }); lines.push('') }
  }
  const tripRef = (ref: string) => (ref === 'new' ? newTripId : UUID.test(ref) && tripById.has(ref) ? ref : null)

  // Cabins. Numbers are checked on the final picture (after every add/renumber/delete of this card), over all
  // cabins of the trips involved — the DB has no unique index on them (and checks the same again on apply).
  const updIds = [...input.cabin_updates.map((c) => c.cabin_id), ...input.delete_cabins]
  const { data: targets, error: ce2 } = updIds.length
    ? await db.from('cabins').select('id, trip_id, yacht_id, cabin_number, deck, bed_type, price, max_guests, guests, status, yachts(name), trips(name)').in('id', updIds)
    : { data: [], error: null }
  if (ce2) throw ce2
  const targetById = new Map((targets ?? []).map((c: any) => [c.id, c]))
  const involvedTrips = [...new Set([
    ...input.add_cabins.map((c) => tripRef(c.trip)).filter((t): t is string => !!t && t !== newTripId),
    ...(targets ?? []).map((c: any) => c.trip_id as string),
  ])]
  const { data: existing, error: ce } = involvedTrips.length
    ? await db.from('cabins').select('id, trip_id, yacht_id, cabin_number').in('trip_id', involvedTrips)
    : { data: [], error: null }
  if (ce) throw ce
  const finalNumbers = new Map<string, { key: string; label: string }>() // cabin id → trip|yacht|number
  for (const c of existing ?? []) finalNumbers.set(c.id, { key: `${c.trip_id}|${c.yacht_id}|${c.cabin_number}`, label: c.cabin_number })

  const added = new Map<string, string[]>() // "yacht · trip" → lines
  for (const c of input.add_cabins) {
    const trip = tripRef(c.trip)
    if (!trip) return fail(`trip «${c.trip}» — нужен id тура из контекста или "new" вместе с new_trip.`)
    const yacht = yachtRef(c.yacht)
    if (!yacht) return fail(`yacht «${c.yacht}» — нужен id лодки из контекста или точное имя из new_yachts.`)
    const num = blank(c.cabin_number)
    if (!num) return fail('у каюты нет номера.')
    if (!(c.price >= 0) || !(c.max_guests >= 1 && c.max_guests <= 8)) return fail(`у каюты ${yacht.name} #${num} странная цена или вместимость.`)
    const bad = badEnum(c)
    if (bad) return fail(`каюта ${yacht.name} #${num}: ${bad}`)
    const newId = crypto.randomUUID()
    finalNumbers.set(newId, { key: `${trip}|${yacht.id}|${num}`, label: `${yacht.name} #${num}` })
    cabinActions.push({ type: 'create_cabin', id: newId, trip_id: trip, yacht_id: yacht.id, cabin_number: num, deck: c.deck, bed_type: c.bed_type, price: c.price, max_guests: c.max_guests, status: c.status })
    const group = `${yacht.name} · ${trip === newTripId ? input.new_trip!.name : tripById.get(trip)!.name}`
    added.set(group, [...(added.get(group) ?? []), `#${e(num)} · ${c.deck} · ${c.bed_type} · ${c.max_guests} чел · ${money(c.price)}${c.status !== 'Available' ? ` · ${STATUS_RU[c.status] ?? c.status}` : ''}`])
  }
  for (const [group, rows] of added) lines.push(`➕ <b>${e(group)}</b>: ${rows.length} кают`, ...rows, '')

  for (const u of input.cabin_updates) {
    const c = targetById.get(u.cabin_id)
    if (!c) return fail(`каюты ${u.cabin_id} нет.`)
    const bad = badEnum(u)
    if (bad) return fail(`каюта ${c.yachts?.name} #${c.cabin_number}: ${bad}`)
    const set: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}
    const diffs: string[] = []
    const num = blank(u.cabin_number)
    if (num && num !== c.cabin_number) {
      finalNumbers.set(c.id, { key: `${c.trip_id}|${c.yacht_id}|${num}`, label: `${c.yachts?.name} #${num}` })
      set.cabin_number = num; expected.cabin_number = c.cabin_number; diffs.push(`номер #${e(c.cabin_number)} → #${e(num)}`)
    }
    for (const k of ['deck', 'bed_type'] as const) {
      const v = u[k]
      if (v && v !== c[k]) { set[k] = v; expected[k] = c[k]; diffs.push(`${k === 'deck' ? 'палуба' : 'кровать'}: ${e(c[k] ?? 'пусто')} → ${e(v)}`) }
    }
    if (u.price !== null && Number(u.price) !== Number(c.price)) {
      if (!(u.price >= 0)) return fail('цена не может быть отрицательной.')
      set.price = u.price; expected.price = c.price === null ? null : String(c.price); diffs.push(`цена: ${money(c.price)} → ${money(u.price)}`)
    }
    if (u.max_guests !== null && u.max_guests !== c.max_guests) {
      if (!(u.max_guests >= 1 && u.max_guests <= 8)) return fail('мест в каюте — от 1 до 8.')
      set.max_guests = u.max_guests; expected.max_guests = String(c.max_guests); diffs.push(`мест: ${c.max_guests} → ${u.max_guests}`)
    }
    if (!diffs.length) continue
    // expected values as the DB renders them in to_jsonb(...)->>k
    for (const k of Object.keys(expected)) if (expected[k] !== null) expected[k] = String(expected[k])
    cabinActions.push({ type: 'update_cabin_fields', cabin_id: c.id, set, expected })
    lines.push(`✏️ <b>${e(c.yachts?.name ?? '?')} #${e(c.cabin_number)}</b> (${e(c.trips?.name ?? '')}): ${diffs.join('; ')}`)
  }
  for (const id of input.delete_cabins) {
    const c = targetById.get(id)
    if (!c) return fail(`каюты ${id} нет.`)
    if ((c.guests ?? '').trim()) return fail(`в каюте ${c.yachts?.name} #${c.cabin_number} живут (${c.guests}) — сначала переселить.`)
    if (!OPEN_FOR_DELETE.includes(c.status)) return fail(`каюта ${c.yachts?.name} #${c.cabin_number} со статусом ${c.status} — удалить можно только свободную.`)
    finalNumbers.delete(id)
    cabinActions.push({ type: 'delete_cabin', cabin_id: id })
    lines.push(`🗑 Удалить каюту <b>${e(c.yachts?.name ?? '?')} #${e(c.cabin_number)}</b> (${e(c.trips?.name ?? '')})`)
  }
  if (input.cabin_updates.length || input.delete_cabins.length) lines.push('')
  const seen = new Map<string, string>()
  for (const [, n] of finalNumbers) {
    if (seen.has(n.key)) return fail(`после этой карточки номер ${n.key.split('|')[2]} будет у двух кают одной лодки в одном туре — перенумеруй и вторую в этой же карточке.`)
    seen.set(n.key, n.label)
  }

  // Photos
  const photoCount = new Map<string, { photos: number; plans: number }>()
  for (const p of input.photos) {
    if (!p.url.startsWith(PHOTO_PREFIX)) return fail('фото — только ссылки из сообщений «[Фото …]».')
    const yacht = yachtRef(p.yacht)
    if (!yacht) return fail(`yacht «${p.yacht}» для фото — id лодки или имя из new_yachts.`)
    photoActions.push({ type: 'add_photo', yacht_id: yacht.id, url: p.url, kind: p.kind })
    const n = photoCount.get(yacht.name) ?? { photos: 0, plans: 0 }
    p.kind === 'deck_plan' ? n.plans++ : n.photos++
    photoCount.set(yacht.name, n)
  }
  for (const [name, n] of photoCount) {
    lines.push(`🖼 ${e(name)}: ${[n.photos ? `${n.photos} фото` : '', n.plans ? 'план палуб' : ''].filter(Boolean).join(' + ')}`)
  }

  // Order matters: rows referenced by later actions are created first
  const actions = [...yachtActions, ...tripActions, ...cabinActions, ...photoActions]
  return sendCard(db, chatId, adminId, input.summary, actions, lines)
}
