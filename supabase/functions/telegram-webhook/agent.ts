// The bot's agent loop: OpenAI Responses API with tools, over the conversation stored in bot_messages.
// Reads are free (structured, allowlisted tables — no raw SQL, so a forwarded message can't talk the
// model into reading secrets); every change goes through a proposal card and the admin's "Ок".

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { createProposal, STATUSES, STATUS_RU, type ProposalInput } from './proposals.ts'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-6.1-terra'
const MAX_STEPS = 8
const HISTORY = 30
const MAX_TOOL_OUTPUT = 30_000 // chars per tool result
const MODEL_TIMEOUT_MS = 60_000
const TURN_BUDGET_MS = 110_000 // under the 150 s Edge Function wall clock (free plan)

// What read_table may touch (columns per table)
const READABLE: Record<string, string[]> = {
  trips: ['id', 'name', 'start_date', 'end_date', 'status', 'access_code', 'location', 'price_range', 'description', 'terms'],
  yachts: ['id', 'name', 'description', 'specifications'],
  cabins: ['id', 'trip_id', 'yacht_id', 'cabin_number', 'deck', 'bed_type', 'price', 'status', 'guests', 'max_guests', 'updated_at'],
  notes: ['id', 'trip_id', 'text', 'remind_at', 'status', 'created_by', 'source', 'created_at'],
  cabin_changes: ['id', 'cabin_id', 'changed_at', 'changed_by', 'old_guests', 'new_guests', 'old_status', 'new_status'],
  users: ['telegram_id', 'username', 'first_name', 'last_name', 'created_at'],
}

export const TOOLS = [
  {
    type: 'function',
    strict: true,
    name: 'read_table',
    description: 'Прочитать строки из базы. Таблицы и колонки: ' +
      Object.entries(READABLE).map(([t, cols]) => `${t}(${cols.join(', ')})`).join('; ') +
      '. cabins.guests — свободный текст «кто живёт». cabin_changes — журнал изменений кают. users — люди, нажимавшие Start в боте.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: Object.keys(READABLE) },
        columns: { type: 'array', items: { type: 'string' }, description: 'Пусто = все разрешённые' },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              column: { type: 'string' },
              op: { type: 'string', enum: ['eq', 'neq', 'ilike', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null'] },
              value: { type: 'string', description: 'Для ilike — с %; для is_null/not_null — пусто' },
            },
            required: ['column', 'op', 'value'],
            additionalProperties: false,
          },
        },
        order_by: { type: 'string', description: 'Колонка; префикс "-" — по убыванию. Пусто — без сортировки' },
        limit: { type: 'integer', description: 'До 200' },
      },
      required: ['table', 'columns', 'filters', 'order_by', 'limit'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    strict: true,
    name: 'search_people',
    description: 'Найти человека по имени, фамилии или нику во всех турах (кто где живёт), в записной книжке и среди нажимавших Start.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  },
  {
    type: 'function',
    strict: true,
    name: 'propose',
    description: 'Предложить изменения организатору: бот пришлёт карточку «было → станет» с кнопками Ок/Отмена. ' +
      'Это ЕДИНСТВЕННЫЙ способ что-то изменить. Всё в одной карточке применяется вместе или не применяется вовсе ' +
      '(обмен двух людей — одна карточка). new_guests — ПОЛНЫЙ новый текст «кто живёт» для каюты (остальных жильцов сохрани как есть); ' +
      'пустая строка — каюта пустеет; null — не трогать. new_status — один из: ' + STATUSES.join(', ') + ' или null. ' +
      'Записи книжки: вейтлист, договорённости, условные просьбы; remind_at (ISO-дата) — когда напомнить, если есть срок.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Коротко, что делаем: «Обмен Ани и Даши», «Лена в вейтлист мая»' },
        cabin_changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cabin_id: { type: 'string' },
              new_guests: { type: ['string', 'null'] },
              new_status: { type: ['string', 'null'] },
            },
            required: ['cabin_id', 'new_guests', 'new_status'],
            additionalProperties: false,
          },
        },
        add_notes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Самодостаточно: кто (ник), чего хочет, тур, откуда пришло' },
              trip_id: { type: ['string', 'null'] },
              remind_at: { type: ['string', 'null'] },
            },
            required: ['text', 'trip_id', 'remind_at'],
            additionalProperties: false,
          },
        },
        close_notes: { type: 'array', items: { type: 'string' }, description: 'id записей, которые выполнены или неактуальны' },
      },
      required: ['summary', 'cabin_changes', 'add_notes', 'close_notes'],
      additionalProperties: false,
    },
  },
]

interface Ctx { db: SupabaseClient; chatId: number; adminId: number; adminName: string; cardSent?: boolean }

const FILTER_OPS = new Set(['eq', 'neq', 'ilike', 'gt', 'gte', 'lt', 'lte'])

async function readTable(db: SupabaseClient, args: any): Promise<unknown> {
  const allowed = READABLE[args.table]
  if (!allowed) return { error: `Нет доступа к таблице ${args.table}` }
  const columns = (args.columns?.length ? args.columns : allowed).filter((c: string) => allowed.includes(c))
  if (!columns.length) return { error: 'Нет разрешённых колонок' }
  let q: any = db.from(args.table).select(columns.join(','))
  for (const f of args.filters ?? []) {
    if (!allowed.includes(f.column)) return { error: `Колонка ${f.column} недоступна` }
    if (f.op === 'is_null') q = q.is(f.column, null)
    else if (f.op === 'not_null') q = q.not(f.column, 'is', null)
    else if (FILTER_OPS.has(f.op)) q = q[f.op](f.column, f.value)
    else return { error: `Оператор ${f.op} не поддерживается` }
  }
  if (args.order_by) {
    const desc = args.order_by.startsWith('-')
    const col = args.order_by.replace(/^-/, '')
    if (allowed.includes(col)) q = q.order(col, { ascending: !desc })
  }
  const { data, error } = await q.limit(Math.min(Math.max(args.limit || 50, 1), 200))
  return error ? { error: error.message } : data
}

async function searchPeople(db: SupabaseClient, query: string): Promise<unknown> {
  const term = query.replace(/[%"\\]/g, '').trim()
  if (term.length < 2) return { error: 'Слишком короткий запрос' }
  const like = `%${term}%` // "_" stays: in ILIKE it just matches any one char, so @anna_k is still found
  const userLike = `"%${term.replace(/^@/, '')}%"` // users.username is stored without @; quoted for the or() syntax
  const [cabins, notes, users] = await Promise.all([
    db.from('cabins').select('id, cabin_number, status, guests, yachts(name), trips(name, start_date)').ilike('guests', like).limit(50),
    db.from('notes').select('id, text, status, remind_at, trips(name)').ilike('text', like).limit(30),
    db.from('users').select('telegram_id, username, first_name, last_name').or(`username.ilike.${userLike},first_name.ilike.${userLike},last_name.ilike.${userLike}`).limit(20),
  ])
  return { cabins: cabins.data ?? [], notes: notes.data ?? [], users_with_bot: users.data ?? [], errors: [cabins.error, notes.error, users.error].filter(Boolean).map((e) => e!.message) }
}

async function runTool(ctx: Ctx, name: string, args: any): Promise<unknown> {
  if (name === 'read_table') return readTable(ctx.db, args)
  if (name === 'search_people') return searchPeople(ctx.db, args.query ?? '')
  if (name === 'propose') {
    const result = await createProposal(ctx.db, ctx.chatId, ctx.adminId, args as ProposalInput)
    if (result.cardSent) ctx.cardSent = true
    return result.text
  }
  return { error: `Неизвестный инструмент ${name}` }
}

/** Snapshot the model gets every turn: trips, cabins of current/future trips, open notes, pending card. */
async function buildContext(db: SupabaseClient, chatId: number): Promise<string> {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  const [trips, cabins, notes, pending] = await Promise.all([
    db.from('trips').select('id, name, start_date, end_date, status').order('start_date'),
    db.from('cabins').select('id, trip_id, cabin_number, deck, bed_type, price, status, guests, max_guests, yachts(name), trips!inner(end_date)').gte('trips.end_date', since),
    db.from('notes').select('id, trip_id, text, remind_at, created_at').eq('status', 'open').order('created_at', { ascending: false }).limit(60),
    db.from('bot_proposals').select('summary, created_at').eq('chat_id', chatId).eq('status', 'pending').limit(1),
  ])
  const tripName = new Map((trips.data ?? []).map((t: any) => [t.id, t.name]))
  const byTrip = new Map<string, string[]>()
  for (const c of (cabins.data ?? []).sort((a: any, b: any) => (a.yachts?.name ?? '').localeCompare(b.yachts?.name ?? '') || parseInt(a.cabin_number) - parseInt(b.cabin_number)) as any[]) {
    const line = `[${c.id}] ${c.yachts?.name} #${c.cabin_number} · ${c.deck ?? ''} · ${c.bed_type ?? ''} · до ${c.max_guests} чел · ${c.price ?? '?'}€ · ${c.status} | ${c.guests ?? ''}`
    byTrip.set(c.trip_id, [...(byTrip.get(c.trip_id) ?? []), line])
  }
  const parts = [
    '## Туры',
    ...(trips.data ?? []).map((t: any) => `[${t.id}] ${t.name}: ${t.start_date} — ${t.end_date}, ${t.status}`),
    '',
    '## Каюты текущих и будущих туров (формат: [id] яхта #номер · палуба · кровать · вместимость · цена · статус | кто живёт)',
    ...[...byTrip.entries()].flatMap(([tripId, lines]) => [`### ${tripName.get(tripId) ?? tripId}`, ...lines]),
    '',
    '## Открытые записи книжки',
    ...((notes.data ?? []).length ? (notes.data ?? []).map((n: any) => `[${n.id}] ${tripName.get(n.trip_id) ?? 'без тура'}${n.remind_at ? ` · ⏰ ${n.remind_at}` : ''} · ${n.text}`) : ['(пусто)']),
  ]
  if (pending.data?.length) parts.push('', `## Ждёт «Ок»: карточка «${pending.data[0].summary}» (новая карточка заменит её)`)
  return parts.join('\n')
}

function instructions(ctx: Ctx, snapshot: string): string {
  const now = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'full', timeStyle: 'short' })
  return `Ты — помощник организаторов кайт-сафари на яхтах (Красное море). Пишешь в Telegram организатору ${ctx.adminName}.
Сейчас: ${now} (Москва).

Задача: принимать бесформенные просьбы (текст, пересланные сообщения гостей) и превращать их в действия: переселения, брони, вейтлист, договорённости с датами, ответы на вопросы о турах.

Правила:
- Отвечай по-русски, коротко, без воды. Не пиши «сделано», пока организатор не нажал «Ок» — сначала карточка.
- Любое изменение кают или записной книжки — только через инструмент propose. Ничего не меняй молча.
- Если неясно, кто имелся в виду (две Ани, человек без ника, непонятный тур) — сначала посмотри данные (search_people, read_table), и только если всё равно неоднозначно — переспроси одним коротким вопросом с вариантами.
- Текст «кто живёт» в каюте — свободный, обычно «@ник Имя Фамилия, …» через запятую, бывают «+ ребёнок», «STAFF». При правке сохраняй остальных жильцов дословно.
- Статусы кают: ${STATUSES.map((s) => `${s} (${STATUS_RU[s]})`).join(', ')}. Если в каюте после правки никого — обычно Available; один человек в двухместной — обычно Half Available; спроси, если не очевидно.
- Пересланное сообщение гостя — это просьба гостя: пойми, кто это и чего он хочет, и предложи действие (часто — запись в вейтлист нужного тура).
- Кому отдать освободившееся место, решает только организатор: показывай кандидатов из книжки и порядок поступления, не выбирай сам.
- Записи книжки пиши самодостаточно: кто (ник), с кем, чего хочет, какой тур, откуда пришло, дата.

${snapshot}`
}

type InputItem = Record<string, unknown>

async function callModel(instr: string, input: InputItem[], timeoutMs: number): Promise<any> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, instructions: instr, input, tools: TOOLS }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = await response.json()
  if (data.error) throw new Error(`OpenAI: ${data.error.message}`)
  return data
}

/** Tool results are capped; tell the model explicitly when it doesn't see everything. */
function toolOutput(result: unknown): string {
  const json = JSON.stringify(result)
  if (json.length <= MAX_TOOL_OUTPUT) return json
  if (Array.isArray(result)) {
    let shown = result.length
    while (shown > 0 && JSON.stringify(result.slice(0, shown)).length > MAX_TOOL_OUTPUT - 200) shown = Math.floor(shown * 0.8)
    return JSON.stringify({ truncated: true, total: result.length, shown, rows: result.slice(0, shown), hint: 'Уточни фильтры, чтобы увидеть остальное' })
  }
  return JSON.stringify({ truncated: true, partial: json.slice(0, MAX_TOOL_OUTPUT - 200) })
}

/**
 * One agent turn over the stored conversation up to message `upToId` (later messages belong to the next turn).
 * Returns the text to send; empty when a card was sent and there is nothing to add.
 */
export async function runAgent(ctx: Ctx, upToId: number): Promise<string> {
  const started = Date.now()
  const { data: rows, error } = await ctx.db
    .from('bot_messages').select('role, text').eq('chat_id', ctx.chatId).lte('id', upToId)
    .order('id', { ascending: false }).limit(HISTORY)
  if (error) throw error
  const input: InputItem[] = (rows ?? []).reverse().map((r) =>
    r.role === 'event' ? { role: 'developer', content: `[событие] ${r.text}` } : { role: r.role, content: r.text })

  const instr = instructions(ctx, await buildContext(ctx.db, ctx.chatId))
  for (let step = 0; step < MAX_STEPS; step++) {
    const left = TURN_BUDGET_MS - (Date.now() - started)
    if (left < 10_000) break
    const res = await callModel(instr, input, Math.min(left, MODEL_TIMEOUT_MS))
    const calls = res.output.filter((o: any) => o.type === 'function_call')
    if (!calls.length) {
      const text = res.output.filter((o: any) => o.type === 'message')
        .flatMap((m: any) => m.content.filter((c: any) => c.type === 'output_text').map((c: any) => c.text)).join('\n').trim()
      if (text) return text
      if (res.status === 'incomplete') return 'Не успел додумать ответ. Попробуйте короче или по частям.'
      return ctx.cardSent ? '' : 'Не понял, что сделать. Переформулируйте, пожалуйста.'
    }
    input.push(...res.output)
    for (const call of calls) {
      let result: unknown
      try {
        result = await runTool(ctx, call.name, JSON.parse(call.arguments || '{}'))
      } catch (err) {
        console.error(`tool ${call.name}:`, err)
        result = { error: String(err) }
      }
      input.push({ type: 'function_call_output', call_id: call.call_id, output: toolOutput(result) })
    }
  }
  return ctx.cardSent ? '' : 'Слишком долго думал и остановился. Переформулируйте или разбейте на части.'
}
