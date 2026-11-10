// People, requests, follow-ups and guest applications without the model: calls the same functions the bot's
// tools call, checks the rows, cleans everything up. Telegram is mocked.
// Test people are named «ТЕСТ …» and written by a fake actor, so cleanup finds exactly them.
// The parts that message admins (follow-ups, guest applications) or replace the guest brief run only against
// a local database: on the live one they would leave events in the organisers' real chats and take the real
// brief away from guests. Run: tests/bot/people.sh
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { closeNotes, findPeople, livesIn, mergePeople, record, setGuestBrief, type RecordInput } from '../../supabase/functions/telegram-webhook/people.ts'
import { resolveFollowUp, sendDueFollowUps } from '../../supabase/functions/telegram-webhook/followups.ts'

const url = Deno.env.get('SUPABASE_URL')!
const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const LOCAL = /127\.0\.0\.1|localhost/.test(url)
const ADMIN = 999000113
const ACTOR = `bot:${ADMIN}`
const TG_A = 999000201, TG_GUEST = 999000202

const sent: { method: string; body: any }[] = []
let nextId = 7000
Deno.serve({ port: 8787, onListen() {} }, async (req) => {
  const body = await req.json().catch(() => ({}))
  sent.push({ method: new URL(req.url).pathname.split('/').pop()!, body })
  return Response.json({ ok: true, result: { message_id: nextId++ } })
})

const results: string[] = []
const check = (name: string, ok: boolean, info = '') => { results.push(`${ok ? '✅' : '❌'} ${name}${info ? ` — ${info}` : ''}`); console.log(results.at(-1)) }
const person = (over: Partial<NonNullable<RecordInput['person']>>) => ({ id: null, name: null, tg_username: null, tg_user_id: null, aliases: null, about: null, confirmed_new: false, ...over })
const rec = (input: Partial<RecordInput>) => record(db, ACTOR, 'test', { person: null, trip_id: null, note: null, note_remind_at: null, request: null, ...input }) as Promise<any>

async function cleanup() {
  const { data: people } = await db.from('people').select('id').or('name.like.ТЕСТ %,tg_user_id.in.(999000201,999000202)')
  const ids = (people ?? []).map((p) => p.id)
  if (ids.length) {
    await db.from('notes').delete().in('person_id', ids)
    await db.from('people_changes').delete().in('person_id', ids)
    await db.from('people').delete().in('id', ids) // requests go with them (cascade)
  }
  await db.from('notes').delete().in('created_by', [ACTOR, `guest:${TG_GUEST}`])
  await db.from('trips').delete().eq('access_code', 'test-people-delete')
  await db.from('bot_messages').delete().in('chat_id', [TG_GUEST])
  await db.from('bot_runs').delete().in('chat_id', [TG_GUEST])
  if (LOCAL) await db.from('bot_messages').delete().eq('role', 'event').or('text.like.%ТЕСТ %,text.like.%тест-напоминание%')
}

await cleanup()
const { data: trip } = await db.from('trips').select('id, name').gte('start_date', new Date().toISOString().slice(0, 10)).order('start_date').limit(1).single()
const { data: pastTrip } = await db.from('trips').select('id').lt('start_date', new Date().toISOString().slice(0, 10)).order('start_date').limit(1).single()

try {
  // --- record: create, find again, journal --------------------------------------------------------
  let r = await rec({ person: person({ name: 'ТЕСТ Зорро Тестов', tg_username: '@Test_Zorro' }), trip_id: trip!.id, note: 'Просит предбронь на май', request: { state: 'Хочет предбронь, основная лодка', follow_up_at: null, close: false } })
  check('новый человек с запросом и фактом', r.ok && r.person.created && r.request?.action === 'created' && r.note_saved, JSON.stringify(r).slice(0, 160))
  const rostId = r.person.id
  const { data: p1 } = await db.from('people').select('tg_username').eq('id', rostId).single()
  check('ник хранится без @ и в нижнем регистре', p1?.tg_username === 'test_zorro', p1?.tg_username)
  const { data: feed1 } = await db.from('notes').select('status, person_id').eq('person_id', rostId)
  check('факт лёг в ленту закрытым (не в «открытые дела»)', feed1?.length === 1 && feed1[0].status === 'done')

  r = await rec({ person: person({ tg_username: 'test_zorro' }), trip_id: trip!.id, request: { state: 'Закоммитился на дабл, предоплаты нет', follow_up_at: '2030-01-10T10:00:00+03:00', close: false } })
  check('тот же человек по нику: запрос обновлён, а не создан второй', r.ok && !r.person.created && r.request?.action === 'updated' && r.request.was === 'Хочет предбронь, основная лодка', JSON.stringify(r.request))
  const { data: reqs } = await db.from('requests').select('id, state, follow_up_at').eq('person_id', rostId)
  check('у человека один открытый запрос на тур', reqs?.length === 1 && reqs[0].state.startsWith('Закоммитился') && !!reqs[0].follow_up_at)
  const { data: journal } = await db.from('people_changes').select('field, old_value, new_value, changed_by').eq('request_id', reqs![0].id)
  check('журнал: фраза и срок «было → стало», с автором', journal?.some((j) => j.field === 'state' && j.old_value?.startsWith('Хочет') && j.changed_by === ACTOR) === true && journal?.some((j) => j.field === 'follow_up_at') === true, `${journal?.length} строк`)

  // --- identity -----------------------------------------------------------------------------------
  r = await rec({ person: person({ name: 'ТЕСТ Зорро' }), note: 'ещё что-то' })
  check('похожее имя без ника: ничего не записано, вернулись кандидаты', r.nothing_written && r.candidates?.some((c: any) => c.id === rostId), JSON.stringify(r).slice(0, 120))
  const { count: afterCandidates } = await db.from('people').select('id', { count: 'exact', head: true }).like('name', 'ТЕСТ %')
  check('двойник молча не создан', afterCandidates === 1, `людей ТЕСТ: ${afterCandidates}`)
  r = await rec({ person: person({ name: 'ТЕСТ Зорро Другой', confirmed_new: true }), note: 'это другой Зорро' })
  check('confirmed_new создаёт нового при похожих', r.ok && r.person.created && r.person.id !== rostId)
  const otherId = r.person.id

  r = await rec({ person: person({ name: 'Zorro Ts', tg_username: 'test_zorro', tg_user_id: TG_A }), note: 'переслано с id' })
  const { data: p2 } = await db.from('people').select('name, tg_user_id, aliases').eq('id', rostId).single()
  check('форвард с id: Telegram-ID дописан, другое имя ушло в «другие написания»', r.person.id === rostId && Number(p2?.tg_user_id) === TG_A && p2?.name === 'ТЕСТ Зорро Тестов' && !!p2?.aliases?.includes('Zorro Ts'), JSON.stringify(p2))
  r = await rec({ person: person({ name: 'ТЕСТ Зорро Тестов', tg_username: 'test_zorro_new', tg_user_id: TG_A }), note: 'сменил ник' })
  const { data: p3 } = await db.from('people').select('tg_username, aliases').eq('id', rostId).single()
  check('сменил ник: найден по Telegram-ID, старый ник сохранён', r.person.id === rostId && p3?.tg_username === 'test_zorro_new' && !!p3?.aliases?.includes('@test_zorro'), JSON.stringify(p3))
  r = await rec({ person: person({ id: rostId, name: 'ТЕСТ Зорро' }), note: 'коротко назвали' })
  const { data: p4 } = await db.from('people').select('name').eq('id', rostId).single()
  check('короткое имя при известном id не затирает полное', p4?.name === 'ТЕСТ Зорро Тестов', p4?.name)
  r = await rec({ person: person({ id: rostId, name: 'ТЕСТ Зорро Тестов-Младший', aliases: 'Zorro Ts' }), note: 'назвали полнее' })
  const { data: p5 } = await db.from('people').select('name, aliases').eq('id', rostId).single()
  check('более полное имя заменяет; повтор того же написания не копится', p5?.name === 'ТЕСТ Зорро Тестов-Младший' && (p5.aliases!.match(/Zorro Ts/g) ?? []).length === 1, JSON.stringify(p5))
  await db.from('people').update({ name: 'ТЕСТ Зорро Тестов' }).eq('id', rostId)
  r = await rec({ person: person({ name: 'ТЕСТ Юю', confirmed_new: true }), note: 'короткое имя' })
  r = await rec({ person: person({ name: 'Юю' }), note: 'ещё один Юю?' })
  check('имя из двух букв тоже даёт кандидатов', r.nothing_written === true, JSON.stringify(r).slice(0, 100))
  r = await rec({ person: person({ id: otherId, tg_user_id: TG_A }), note: 'x' })
  check('чужой Telegram-ID второму человеку не записать', !!r.error, r.error)

  // --- validation ---------------------------------------------------------------------------------
  r = await rec({ person: person({ id: rostId }), trip_id: trip!.id, request: { state: 'я'.repeat(301), follow_up_at: null, close: false } })
  check('фраза длиннее 300 знаков отклонена', !!r.error && r.error.includes('300'))
  r = await rec({ person: person({ id: rostId }), trip_id: trip!.id, request: { state: 'ок', follow_up_at: 'послезавтра', close: false } })
  check('срок не датой отклонён', !!r.error && r.error.includes('не дата'))
  r = await rec({ trip_id: '00000000-0000-0000-0000-000000000000', note: 'x' })
  check('несуществующий тур отклонён', !!r.error)
  r = await rec({ request: { state: 'x', follow_up_at: null, close: false } })
  check('запрос без человека отклонён', !!r.error)

  // --- no trip, close, plain notes ----------------------------------------------------------------
  r = await rec({ person: person({ id: rostId }), request: { state: 'Позвать на следующий тур после мая', follow_up_at: null, close: false } })
  check('запрос без тура живёт рядом с запросом на тур', r.ok && r.request.action === 'created' && r.open_requests?.length === 1, JSON.stringify(r.open_requests))
  r = await rec({ person: person({ id: rostId }), trip_id: trip!.id, request: { state: 'Размещён и оплатил', follow_up_at: null, close: true } })
  const { data: closed } = await db.from('requests').select('closed_at, state').eq('person_id', rostId).eq('trip_id', trip!.id).single()
  check('закрытие запроса с итоговой фразой', r.request.action === 'closed' && !!closed?.closed_at && closed.state === 'Размещён и оплатил')
  r = await rec({ person: person({ id: rostId }), trip_id: trip!.id, request: { state: 'Снова хочет: отмена соседа', follow_up_at: null, close: false } })
  check('после закрытия новый запрос на тот же тур создаётся', r.request.action === 'created')

  r = await rec({ trip_id: trip!.id, note: 'тест-напоминание: уточнить план лодки 2', note_remind_at: '2030-02-01T10:00:00+03:00' })
  const { data: plain } = await db.from('notes').select('id, status, person_id, remind_at').eq('id', r.note?.id).single()
  check('заметка без человека — открытое дело с напоминанием', r.ok && plain?.status === 'open' && plain.person_id === null && !!plain.remind_at)
  const closeResult = await closeNotes(db, [r.note.id]) as any
  check('close_notes закрывает дело', closeResult.ok && closeResult.closed.length === 1)
  const { data: fact } = await db.from('notes').select('id').eq('person_id', rostId).limit(1).single()
  check('close_notes не трогает факты ленты', !!((await closeNotes(db, [fact!.id])) as any).error)

  // --- search, merge, brief -----------------------------------------------------------------------
  const found = await findPeople(db, 'test_zorro_new') as any[]
  check('поиск: человек с запросами и лентой', found.length === 1 && found[0].requests.length === 3 && found[0].feed.length >= 3, `${found[0]?.requests.length} запр., ${found[0]?.feed.length} фактов`)
  check('поиск по старому нику (другие написания)', ((await findPeople(db, '@test_zorro')) as any[]).some((p) => p.id === rostId))

  await rec({ person: person({ id: otherId }), trip_id: trip!.id, request: { state: 'Дубль: тоже хочет на май', follow_up_at: null, close: false } })
  const merged = await mergePeople(db, ACTOR, rostId, otherId) as any
  const { data: afterMerge } = await db.from('requests').select('state').eq('person_id', rostId).eq('trip_id', trip!.id).is('closed_at', null)
  const { data: mergedNotes } = await db.from('notes').select('text').eq('person_id', rostId).eq('source', 'merge')
  const { data: gone } = await db.from('people').select('id').eq('id', otherId)
  check('слияние: дубль удалён, его имя в «других написаниях»', merged.ok && !gone?.length && merged.person.aliases.includes('ТЕСТ Зорро Другой'), merged.person?.aliases)
  check('слияние: один открытый запрос на тур, фраза дубля сохранена фактом', afterMerge?.length === 1 && mergedNotes?.some((n) => n.text.includes('тоже хочет на май')) === true)
  const { count: movedFeed } = await db.from('notes').select('id', { count: 'exact', head: true }).eq('person_id', rostId).eq('text', 'это другой Зорро')
  check('слияние: лента дубля переехала', movedFeed === 1)

  check('@ник в тексте каюты: целиком, не часть другого ника', livesIn('@anna_k Аня, @anna_kite Анна', 'anna_k') && !livesIn('@anna_kite Анна', 'anna_k') && !livesIn(null, 'anna_k'))

  // --- follow-ups and guest applications (local database only) ------------------------------------
  if (!LOCAL) {
    console.log('⏭  напоминания и заявки гостей пропущены: они пишут в чаты организаторов, только на локальной базе')
  } else {
    let brief = await setGuestBrief(db, ACTOR, trip!.id, 'ТЕСТ справка 1') as any
    brief = await setGuestBrief(db, ACTOR, trip!.id, 'ТЕСТ справка 2') as any
    const { data: openBriefs } = await db.from('notes').select('text').eq('trip_id', trip!.id).eq('source', 'guest_brief').eq('status', 'open').like('text', 'ТЕСТ %')
    check('справка для гостей заменяется целиком', brief.ok && openBriefs?.length === 1 && openBriefs[0].text === 'ТЕСТ справка 2')
    await setGuestBrief(db, ACTOR, trip!.id, '')
    const { count: briefsLeft } = await db.from('notes').select('id', { count: 'exact', head: true }).eq('trip_id', trip!.id).eq('source', 'guest_brief').eq('status', 'open').like('text', 'ТЕСТ %')
    check('пустая справка убирает её', briefsLeft === 0)

    const { data: tmpTrip } = await db.from('trips').insert({ name: 'ТЕСТ тур на удаление', notion_id: 'test-people-delete', start_date: '2020-01-01', end_date: '2020-01-08', status: 'Closed', access_code: 'test-people-delete' }).select('id').single()
    await rec({ person: person({ id: rostId }), trip_id: tmpTrip!.id, request: { state: 'ТЕСТ запрос на удаляемый тур', follow_up_at: null, close: false } })
    const { error: delError } = await db.from('trips').delete().eq('id', tmpTrip!.id)
    const { data: orphan } = await db.from('requests').select('closed_at, trip_id').eq('person_id', rostId).eq('state', 'ТЕСТ запрос на удаляемый тур').single()
    check('удаление тура закрывает его запросы, а не падает на уникальном индексе', !delError && !!orphan?.closed_at && orphan.trip_id === null, delError?.message)

    const { data: due } = await db.from('requests').select('id').eq('person_id', rostId).eq('trip_id', trip!.id).is('closed_at', null).single()
    await db.from('requests').update({ follow_up_at: new Date(Date.now() - 3600_000).toISOString() }).eq('id', due!.id)
    await rec({ note: 'тест-напоминание: позвонить верфи', note_remind_at: new Date(Date.now() - 3600_000).toISOString() })
    await rec({ note: 'тест-напоминание: в будущем', note_remind_at: '2031-01-01T10:00:00+03:00' })
    let before = sent.length
    const first = await sendDueFollowUps(db)
    const reminders = sent.slice(before).filter((m) => m.method === 'sendMessage')
    check('напоминания: ушли просроченный запрос и просроченное дело, будущее — нет', first.requests === 1 && first.notes === 1 && reminders.length >= 2, JSON.stringify(first))
    check('напоминание о запросе: кто, тур, фраза и кнопки', reminders.some((m) => m.body.text.includes('ТЕСТ Зорро Тестов') && m.body.text.includes(trip!.name) && m.body.reply_markup?.inline_keyboard?.[0]?.length === 3))
    before = sent.length
    const second = await sendDueFollowUps(db)
    check('повторный запуск ничего не шлёт второй раз', second.requests === 0 && second.notes === 0 && sent.length === before)

    let outcome = await resolveFollowUp(db, 'r', due!.id, '3', ADMIN)
    const { data: moved } = await db.from('requests').select('follow_up_at, follow_up_sent_at').eq('id', due!.id).single()
    check('«+3 дня»: срок сдвинут, отметка «отправлено» снята', outcome.includes('Напомню') && Date.parse(moved!.follow_up_at) > Date.now() + 2 * 86400_000 && moved!.follow_up_sent_at === null, outcome)
    outcome = await resolveFollowUp(db, 'r', due!.id, 'x', ADMIN)
    const { data: closedByButton } = await db.from('requests').select('closed_at').eq('id', due!.id).single()
    check('«Закрыть запрос» закрывает', !!closedByButton?.closed_at, outcome)
    check('кнопка по уже закрытому запросу — «уже закрыт»', (await resolveFollowUp(db, 'r', due!.id, '7', ADMIN)).includes('уже закрыт'))

    // Guest: the agent's only write and its context, called directly (no model)
    const { tellOrganizer, guestContext } = await import('../../supabase/functions/telegram-webhook/guest.ts')
    const gctx = { db, chatId: TG_GUEST, user: { id: TG_GUEST, first_name: 'ТЕСТ Лена', last_name: 'Кайт', username: 'Test_Lena_Kite' } }
    await db.from('bot_messages').insert({ chat_id: TG_GUEST, role: 'event', text: 'Гость пришёл по ссылке с меткой «guild»' })
    before = sent.length
    let g = await tellOrganizer(gctx, { kind: 'application', trip_id: trip!.id, text: 'Хочет на май с подругой, катаются год, не в подвал' }) as any
    const { data: lena } = await db.from('people').select('id, name, tg_username, tg_user_id').eq('tg_user_id', TG_GUEST).single()
    const { data: lenaReq } = await db.from('requests').select('state, trip_id').eq('person_id', lena!.id)
    const { data: lenaFeed } = await db.from('notes').select('text, created_by, source').eq('person_id', lena!.id)
    const toAdmin = sent.slice(before).filter((m) => m.method === 'sendMessage')
    check('заявка гостя: человек по Telegram-ID, запрос и факт с меткой ссылки', g.ok && lena?.tg_username === 'test_lena_kite' && lenaReq?.length === 1 && lenaReq[0].state.startsWith('Заявка через бота') && lenaFeed?.[0].created_by === `guest:${TG_GUEST}` && lenaFeed[0].text.includes('guild'), JSON.stringify(lenaReq))
    check('заявка гостя: организатор получил сообщение сразу', toAdmin.length >= 1 && toAdmin[0].body.text.includes('Заявка через бота') && toAdmin[0].body.text.includes('@Test_Lena_Kite') && toAdmin[0].body.text.includes('новый контакт'), toAdmin[0]?.body.text.slice(0, 80))
    await db.from('requests').update({ state: 'ТЕСТ: фраза организатора', changed_by: ACTOR }).eq('person_id', lena!.id)
    g = await tellOrganizer(gctx, { kind: 'application', trip_id: trip!.id, text: 'Дополнение: нас будет трое' }) as any
    const { data: lenaReq2 } = await db.from('requests').select('state').eq('person_id', lena!.id)
    check('повторная заявка не переписывает фразу организатора', g.ok && lenaReq2?.length === 1 && lenaReq2[0].state === 'ТЕСТ: фраза организатора')
    g = await tellOrganizer(gctx, { kind: 'question', trip_id: null, text: 'Можно ли с собакой?' }) as any
    const { count: lenaNotes } = await db.from('notes').select('id', { count: 'exact', head: true }).eq('person_id', lena!.id)
    check('вопрос гостя: факт в ленте, нового запроса нет', g.ok && lenaNotes === 3 && lenaReq2?.length === 1)
    g = await tellOrganizer(gctx, { kind: 'application', trip_id: pastTrip!.id, text: 'x' }) as any
    check('заявка гостя на прошедший тур не принимается', g.error === 'такого тура нет', JSON.stringify(g).slice(0, 80))

    for (let i = 0; i < 4; i++) g = await tellOrganizer(gctx, { kind: 'question', trip_id: null, text: `ещё вопрос ${i}` })
    check('дневной лимит передач организатору', !!g.error, g.error)
    // The guest's view: no brief — sales "not open"; with a brief — yes/no on places, never names
    await rec({ person: person({ name: 'ТЕСТ Секретный Гость', confirmed_new: true }), trip_id: trip!.id, note: 'ТЕСТ тянет с оплатой', request: { state: 'ТЕСТ должен 1800', follow_up_at: null, close: false } })
    const { data: briefBackup } = await db.from('notes').select('id').eq('trip_id', trip!.id).eq('source', 'guest_brief').eq('status', 'open')
    if (!briefBackup?.length) {
      const closedView = await guestContext(gctx)
      check('гостю без справки: «запись не открыта», без цен и мест', closedView.includes('ещё НЕ открыта') && !closedView.includes('Места сейчас'))
      await setGuestBrief(db, ACTOR, trip!.id, 'ТЕСТ запись открыта, половинка от 1700')
      const openView = await guestContext(gctx)
      check('гостю со справкой: справка и «есть места / нет»', openView.includes('ТЕСТ запись открыта') && openView.includes('Места сейчас'))
      const { data: guestNames } = await db.from('cabins').select('guests').eq('trip_id', trip!.id).not('guests', 'is', null)
      const leaked = (guestNames ?? []).map((c) => c.guests!.trim()).filter((gs) => gs.length > 3 && openView.includes(gs))
      check('в контексте гостя нет жильцов кают, чужих запросов и фактов', !leaked.length && !openView.includes('Секретный') && !openView.includes('1800') && !openView.includes('тянет'), leaked.join(' | '))
      await setGuestBrief(db, ACTOR, trip!.id, '')
    }
  }
} catch (err) {
  check('тест не упал', false, err instanceof Error ? err.message : JSON.stringify(err))
} finally {
  await cleanup()
  const { count: left } = await db.from('people').select('id', { count: 'exact', head: true }).like('name', 'ТЕСТ %')
  check('после теста тестовых людей не осталось', left === 0)
  const failed = results.filter((r) => r.startsWith('❌')).length
  console.log(`\n${results.length - failed}/${results.length} проверок прошло`)
  void pastTrip
  Deno.exit(failed ? 1 : 0)
}
