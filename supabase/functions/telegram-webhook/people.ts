// People, requests and the feed of facts — the "lazy CRM" (migration 018, docs/ARCHITECTURE.md).
//   people   — a contact; requests — an open matter of a person (usually about one trip) as a free-text
//   phrase with an optional date; notes with person_id — the append-only feed the phrases are built from.
// Written directly, without a confirmation card: the bot echoes what it recorded and the organiser corrects
// it in words. Identity is checked here in code, not in the prompt: a new person is never created silently
// when similar ones exist.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const STATE_MAX = 300
export const ABOUT_MAX = 800
const BRIEF_MAX = 2000
export const GUEST_BRIEF = 'guest_brief' // notes.source of "what the bot may tell guests about this trip"

export interface PersonInput {
  id: string | null
  name: string | null
  tg_username: string | null
  tg_user_id: number | null
  aliases: string | null
  about: string | null
  confirmed_new: boolean
}
export interface RecordInput {
  person: PersonInput | null
  trip_id: string | null
  note: string | null
  note_remind_at: string | null
  request: { state: string; follow_up_at: string | null; close: boolean } | null
}

export type Person = { id: string; name: string; tg_user_id: number | null; tg_username: string | null; aliases: string | null; about: string | null }
const PERSON_COLS = 'id, name, tg_user_id, tg_username, aliases, about'

const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null)
export const normUsername = (s: string | null | undefined) => blank(s)?.replace(/^@/, '').toLowerCase() ?? null
// For PostgREST or()/ilike values: drop what would break the filter syntax. "_" stays (usernames have it);
// in ILIKE it matches any one character, which only makes a search slightly wider.
const likeSafe = (s: string) => s.replace(/[%,()"\\*]/g, ' ').trim()
const userSafe = (s: string) => s.replace(/[^a-z0-9_]/gi, '')
const personLabel = (p: Person) => `${p.name}${p.tg_username ? ` (@${p.tg_username})` : ''}`

function parseDate(value: string | null | undefined, what: string): { iso: string | null; error?: string } {
  const v = blank(value)
  if (!v) return { iso: null }
  if (Number.isNaN(Date.parse(v))) return { iso: null, error: `${what} "${v}" — не дата (нужен ISO, например 2026-12-15T10:00:00+03:00).` }
  return { iso: new Date(v).toISOString() }
}

/** People who could be the same person: same username anywhere, or a word of the name in name/aliases. */
export async function similarPeople(db: SupabaseClient, name: string | null, username: string | null, exceptId?: string): Promise<Person[]> {
  const terms = new Set<string>()
  for (const word of likeSafe(name ?? '').split(/\s+/)) if (word.length >= 2) terms.add(word) // «Ян», «Ия» are names too
  const conditions = [...terms].flatMap((t) => [`name.ilike.%${t}%`, `aliases.ilike.%${t}%`])
  if (username && userSafe(username)) conditions.push(`tg_username.eq.${userSafe(username)}`, `aliases.ilike.%${userSafe(username)}%`)
  if (!conditions.length) return []
  const { data, error } = await db.from('people').select(PERSON_COLS).or(conditions.join(',')).limit(12)
  if (error) throw error
  return ((data ?? []) as Person[]).filter((p) => p.id !== exceptId)
}

/** The Telegram id of someone who pressed Start, by username — the only stable key we can get for free. */
async function startedUserId(db: SupabaseClient, username: string | null): Promise<number | null> {
  if (!username) return null
  const { data } = await db.from('users').select('telegram_id, username').ilike('username', userSafe(username)).limit(5)
  const exact = (data ?? []).filter((u) => u.username?.toLowerCase() === username) // "_" in ILIKE is a wildcard
  return exact.length === 1 ? Number(exact[0].telegram_id) : null
}

type Resolved = { person: Person; created: boolean } | { error: string } | { candidates: Person[] }

async function resolvePerson(db: SupabaseClient, input: PersonInput, actor: string): Promise<Resolved> {
  const username = normUsername(input.tg_username)
  const name = blank(input.name)
  const about = blank(input.about)
  const aliases = blank(input.aliases)
  if (about && about.length > ABOUT_MAX) return { error: `about длиннее ${ABOUT_MAX} знаков — оставь только устойчивое между турами, остальное в note.` }
  const tgId = input.tg_user_id && Number.isFinite(Number(input.tg_user_id)) ? Number(input.tg_user_id) : null

  let found: Person | null = null
  let nameIsExplicit = false
  if (blank(input.id)) {
    if (!UUID.test(input.id!)) return { error: 'person.id должен быть id человека из контекста или search_people (или null для нового).' }
    const { data, error } = await db.from('people').select(PERSON_COLS).eq('id', input.id).maybeSingle()
    if (error) throw error
    if (!data) return { error: `человека ${input.id} нет.` }
    found = data as Person
    nameIsExplicit = true
  } else {
    if (tgId) {
      const { data, error } = await db.from('people').select(PERSON_COLS).eq('tg_user_id', tgId).maybeSingle()
      if (error) throw error
      found = data as Person | null
    }
    if (!found && username) {
      const { data, error } = await db.from('people').select(PERSON_COLS).eq('tg_username', username).limit(3)
      if (error) throw error
      const same = ((data ?? []) as Person[]).filter((p) => !tgId || !p.tg_user_id || p.tg_user_id === tgId)
      if (same.length === 1) found = same[0]
    }
  }

  if (!found) {
    if (!name) return { error: 'для нового человека нужно имя (person.name).' }
    if (!input.confirmed_new) {
      const candidates = await similarPeople(db, name, username)
      if (candidates.length) return { candidates }
    }
    const { data, error } = await db.from('people')
      .insert({ name, tg_username: username, tg_user_id: tgId ?? await startedUserId(db, username), aliases, about })
      .select(PERSON_COLS).single()
    if (error?.code === '23505') {
      // The Telegram id (given, or found among those who pressed Start) already belongs to someone: show who
      const id = tgId ?? await startedUserId(db, username)
      const { data: owner } = id ? await db.from('people').select(PERSON_COLS).eq('tg_user_id', id).maybeSingle() : { data: null }
      return owner ? { candidates: [owner as Person] } : { error: 'человек с таким Telegram-ID уже есть — найди его через search_people и укажи person.id.' }
    }
    if (error) throw error
    return { person: data as Person, created: true }
  }

  // Known person: fill in what is new. The name only grows («Лёша» → «Лёша Фишкин», and only when the person
  // was picked by id); any other spelling — a display name from a forward, a short «Аня» — goes to aliases.
  const patch: Record<string, unknown> = {}
  const known = () => `${found!.name} ${(patch.aliases as string | undefined) ?? found!.aliases ?? ''}`.toLowerCase()
  const addAlias = (value: string) => {
    if (!known().includes(value.toLowerCase())) patch.aliases = [patch.aliases ?? found!.aliases, value].filter(Boolean).join('; ')
  }
  if (name && name !== found.name) {
    if (nameIsExplicit && name.toLowerCase().includes(found.name.toLowerCase())) patch.name = name
    else addAlias(name)
  }
  if (aliases) for (const alias of aliases.split(';').map((a) => a.trim()).filter(Boolean)) addAlias(alias)
  if (username && username !== found.tg_username) {
    patch.tg_username = username
    if (found.tg_username) addAlias(`@${found.tg_username}`)
  }
  if (about && about !== found.about) patch.about = about
  if (!found.tg_user_id) {
    const id = tgId ?? await startedUserId(db, username ?? found.tg_username)
    if (id) patch.tg_user_id = id
  } else if (tgId && tgId !== found.tg_user_id) {
    return { error: `у ${personLabel(found)} другой Telegram-ID (${found.tg_user_id}), а пришёл ${tgId}: это другой человек или не тот id.` }
  }
  if (!Object.keys(patch).length) return { person: found, created: false }
  const { data, error } = await db.from('people').update({ ...patch, changed_by: actor }).eq('id', found.id).select(PERSON_COLS).single()
  if (error?.code === '23505') return { error: 'этот Telegram-ID уже записан у другого человека — похоже на дубль, предложи организатору объединить (merge_people).' }
  if (error) throw error
  return { person: data as Person, created: false }
}

/**
 * Record what was said: who (found or created), the fact for the feed, and the state of the request.
 * Returns a compact object for the model; `error` / `candidates` mean nothing was written.
 *
 * `seen` — people whose feed the model has already been shown this turn. A fact about a known person who is
 * not in it is not written yet: the call returns the person's latest facts first, so a message forwarded twice
 * or a plain «ну что там?» is recognised instead of piling up. Callers without a model pass nothing.
 */
export async function record(db: SupabaseClient, actor: string, source: string, input: RecordInput, seen?: Set<string>): Promise<unknown> {
  const tripId = blank(input.trip_id)
  if (tripId) {
    if (!UUID.test(tripId)) return { error: 'trip_id должен быть id тура из контекста (или null).' }
    const { data, error } = await db.from('trips').select('id').eq('id', tripId).maybeSingle()
    if (error) throw error
    if (!data) return { error: 'такого тура нет.' }
  }
  const note = blank(input.note)
  const remind = parseDate(input.note_remind_at, 'note_remind_at')
  if (remind.error) return { error: remind.error }
  const req = input.request
  const state = blank(req?.state)
  const followUp = parseDate(req?.follow_up_at, 'follow_up_at')
  if (followUp.error) return { error: followUp.error }
  if (req && !input.person) return { error: 'запрос (request) бывает только у человека — укажи person.' }
  if (req && !state && !req.close) return { error: 'request.state пуст.' }
  if (state && state.length > STATE_MAX) return { error: `request.state длиннее ${STATE_MAX} знаков (${state.length}) — сожми до сути, подробности положи в note.` }
  if (!input.person && !note) return { error: 'нечего записывать: нет ни person, ни note.' }

  // A plain note of the organiser (no person): an open item of the notebook, optionally with a reminder.
  if (!input.person) {
    const { data, error } = await db.from('notes')
      .insert({ trip_id: tripId, text: note, remind_at: remind.iso, created_by: actor, source })
      .select('id').single()
    if (error) throw error
    return { ok: true, note: { id: data.id, remind_at: remind.iso } }
  }

  const resolved = await resolvePerson(db, input.person, actor)
  if ('error' in resolved) return { error: resolved.error }
  if ('candidates' in resolved) {
    return {
      nothing_written: true,
      candidates: resolved.candidates.map((p) => ({ id: p.id, name: p.name, tg_username: p.tg_username, aliases: p.aliases, about: p.about })),
      hint: 'Есть похожие люди. Тот же человек — повтори с его person.id. Явно другой — повтори с confirmed_new=true. Не ясно — спроси организатора.',
    }
  }
  const person = resolved.person
  if (seen && !resolved.created && !seen.has(person.id) && (note || req)) {
    seen.add(person.id)
    const [facts, open] = await Promise.all([
      db.from('notes').select('text, created_at, created_by, trips(name)').eq('person_id', person.id).order('created_at', { ascending: false }).limit(6),
      db.from('requests').select('state, follow_up_at, created_at, trips(name)').eq('person_id', person.id).is('closed_at', null),
    ])
    if (facts.error) throw facts.error
    if (facts.data?.length) {
      return {
        nothing_written: true,
        person: { id: person.id, name: person.name, tg_username: person.tg_username },
        recent_facts: facts.data.map((n: any) => ({ date: n.created_at.slice(0, 10), trip: n.trips?.name ?? null, text: n.text, by: n.created_by })),
        open_requests: (open.data ?? []).map((r: any) => ({ trip: r.trips?.name ?? 'без тура', since: r.created_at.slice(0, 10), state: r.state, follow_up_at: r.follow_up_at })),
        hint: 'Сначала сверься с лентой. То же самое уже записано — не записывай, ответь «уже есть, с <дата>». ' +
          'Человек просто напоминает о себе без новой информации — повтори вызов с коротким note («напомнил о себе, ждёт ответа») и request=null. ' +
          'Есть новое — повтори вызов как был.',
      }
    }
  }
  const result: Record<string, unknown> = {
    ok: true,
    person: { id: person.id, name: person.name, tg_username: person.tg_username, created: resolved.created, about: person.about },
    // No username and no Telegram id: the person can only be recognised by name next time
    ...(person.tg_username || person.tg_user_id ? {} : { no_contact: true }),
  }

  if (req) {
    let open = db.from('requests').select('id, state').eq('person_id', person.id).is('closed_at', null)
    open = tripId ? open.eq('trip_id', tripId) : open.is('trip_id', null)
    const { data: existing, error } = await open.maybeSingle()
    if (error) throw error
    if (req.close) {
      if (!existing) result.request = { action: 'none', hint: 'открытого запроса по этому туру у человека не было' }
      else {
        const { error: e } = await db.from('requests')
          .update({ state: state ?? existing.state, closed_at: new Date().toISOString(), follow_up_at: null, changed_by: actor }).eq('id', existing.id)
        if (e) throw e
        result.request = { action: 'closed', state: state ?? existing.state }
      }
    } else if (existing) {
      const { error: e } = await db.from('requests').update({ state, follow_up_at: followUp.iso, changed_by: actor }).eq('id', existing.id)
      if (e) throw e
      result.request = { action: 'updated', was: existing.state, state, follow_up_at: followUp.iso }
    } else {
      const { error: e } = await db.from('requests').insert({ person_id: person.id, trip_id: tripId, state, follow_up_at: followUp.iso })
      if (e?.code === '23505') return { error: 'запрос только что создал кто-то другой — повтори, он обновится.' }
      if (e) throw e
      result.request = { action: 'created', state, follow_up_at: followUp.iso }
    }
  }

  // The fact goes in last: if the request part failed above, a retry must not leave the same fact twice
  if (note) {
    // Feed entries are facts, not to-dos: stored closed, so "open notes" stays the organiser's own list
    const { error } = await db.from('notes').insert({ person_id: person.id, trip_id: tripId, text: note, created_by: actor, source, status: 'done' })
    if (error) throw error
    result.note_saved = true
    if (remind.iso) result.hint = 'note_remind_at у записи о человеке не используется — срок ставь в request.follow_up_at.'
  }

  const { data: others } = await db.from('requests').select('trip_id, state, follow_up_at, trips(name)').eq('person_id', person.id).is('closed_at', null)
  const rest = (others ?? []).filter((r: any) => (r.trip_id ?? null) !== tripId || !req)
  if (rest.length) result.open_requests = rest.map((r: any) => ({ trip: r.trips?.name ?? 'без тура', state: r.state, follow_up_at: r.follow_up_at }))
  return result
}

/** People matching a query, each with requests and the latest facts — what the model needs to recognise someone. */
export async function findPeople(db: SupabaseClient, query: string): Promise<unknown[]> {
  const term = likeSafe(query.replace(/^@/, ''))
  if (term.length < 2) return []
  const { data: people, error } = await db.from('people').select(PERSON_COLS)
    .or(`name.ilike.%${term}%,aliases.ilike.%${term}%,tg_username.ilike.%${term}%`).limit(8)
  if (error) throw error
  if (!people?.length) return []
  const ids = people.map((p) => p.id)
  const [requests, notes] = await Promise.all([
    db.from('requests').select('person_id, state, follow_up_at, closed_at, created_at, trips(name)').in('person_id', ids).order('created_at', { ascending: false }).limit(60),
    db.from('notes').select('person_id, text, created_at, created_by, trips(name)').in('person_id', ids).order('created_at', { ascending: false }).limit(80),
  ])
  return (people as Person[]).map((p) => ({
    ...p,
    requests: (requests.data ?? []).filter((r: any) => r.person_id === p.id).slice(0, 6)
      .map((r: any) => ({ trip: r.trips?.name ?? 'без тура', state: r.state, follow_up_at: r.follow_up_at, since: r.created_at.slice(0, 10), closed: r.closed_at?.slice(0, 10) ?? null })),
    feed: (notes.data ?? []).filter((n: any) => n.person_id === p.id).slice(0, 10)
      .map((n: any) => ({ date: n.created_at.slice(0, 10), trip: n.trips?.name ?? null, text: n.text, by: n.created_by })),
  }))
}

export async function mergePeople(db: SupabaseClient, actor: string, keepId: string, dropId: string): Promise<unknown> {
  if (!UUID.test(keepId) || !UUID.test(dropId)) return { error: 'keep_id и drop_id — id людей.' }
  const { error } = await db.rpc('merge_people', { p_keep: keepId, p_drop: dropId, p_actor: actor })
  if (error?.message?.startsWith('KS_MERGE:')) return { error: error.message.slice('KS_MERGE:'.length).trim() }
  if (error) throw error
  const { data } = await db.from('people').select(PERSON_COLS).eq('id', keepId).single()
  return { ok: true, person: data }
}

export async function closeNotes(db: SupabaseClient, ids: string[]): Promise<unknown> {
  if (!ids.length || ids.some((id) => !UUID.test(id))) return { error: 'ids — это id записей книжки из контекста.' }
  // Only the organiser's own items: the guest brief is replaced through set_guest_brief, facts are never "closed"
  const { data: own, error: readError } = await db.from('notes').select('id, source').in('id', ids).eq('status', 'open').is('person_id', null)
  if (readError) throw readError
  const closable = (own ?? []).filter((n) => n.source !== GUEST_BRIEF).map((n) => n.id)
  if (!closable.length) return { error: 'открытых записей книжки с такими id нет.' }
  const { data, error } = await db.from('notes').update({ status: 'done' }).in('id', closable).eq('status', 'open').select('id, text')
  if (error) throw error
  return { ok: true, closed: (data ?? []).map((n) => n.text.slice(0, 120)) }
}

/** What the bot may tell guests about a trip (sales open or not, price orientation, what to ask). One per trip. */
export async function setGuestBrief(db: SupabaseClient, actor: string, tripId: string, text: string): Promise<unknown> {
  if (!UUID.test(tripId)) return { error: 'trip_id должен быть id тура из контекста.' }
  const brief = text.trim()
  if (brief.length > BRIEF_MAX) return { error: `справка длиннее ${BRIEF_MAX} знаков.` }
  const { data: trip, error: tripError } = await db.from('trips').select('name').eq('id', tripId).maybeSingle()
  if (tripError) throw tripError
  if (!trip) return { error: 'такого тура нет.' }
  const { error: closeError } = await db.from('notes').update({ status: 'done' }).eq('trip_id', tripId).eq('source', GUEST_BRIEF).eq('status', 'open')
  if (closeError) throw closeError
  if (!brief) return { ok: true, trip: trip.name, brief: null, hint: 'Справка убрана: гостям бот скажет, что запись ещё не открыта.' }
  const { error } = await db.from('notes').insert({ trip_id: tripId, text: brief, created_by: actor, source: GUEST_BRIEF })
  if (error) throw error
  return { ok: true, trip: trip.name, brief }
}

/** Whether `@username` is written in a cabin's free-text guests. */
export const livesIn = (guests: string | null, username: string | null) =>
  !!guests && !!username && new RegExp(`@${username.replace(/[^a-z0-9_]/gi, '')}(?![a-z0-9_])`, 'i').test(guests)
