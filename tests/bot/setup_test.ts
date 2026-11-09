// Tour setup (propose_setup) without the model: builds cards from hand-written input on the live DB, presses
// «Ок» through the same resolveProposal the bot uses, checks the rows, cleans everything up.
// The test trip is dated 2020 so sheet-sync never makes a tab for it. Run: tests/bot/setup.sh
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { resolveProposal } from '../../supabase/functions/telegram-webhook/proposals.ts'
import { createSetupProposal, PHOTO_PREFIX, type SetupInput } from '../../supabase/functions/telegram-webhook/setup.ts'

const CHAT = 999000112 // not a real Telegram chat
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const YACHT = 'ТЕСТ лодка setup'
const CODE = 'test-setup-2020'

// mock Telegram
const sent: { method: string; body: any }[] = []
let nextId = 5000
Deno.serve({ port: 8787, onListen() {} }, async (req) => {
  const body = await req.json().catch(() => ({}))
  sent.push({ method: new URL(req.url).pathname.split('/').pop()!, body })
  return Response.json({ ok: true, result: { message_id: nextId++ } })
})

const empty: SetupInput = { summary: '', new_trip: null, trip_updates: [], new_yachts: [], yacht_updates: [], add_cabins: [], cabin_updates: [], delete_cabins: [], photos: [] }
const results: string[] = []
const check = (name: string, ok: boolean, info = '') => { results.push(`${ok ? '✅' : '❌'} ${name}${info ? ` — ${info}` : ''}`); console.log(results.at(-1)) }
const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

async function propose(input: Partial<SetupInput>) {
  const before = sent.length
  const res = await createSetupProposal(db, CHAT, CHAT, { ...empty, ...input } as SetupInput)
  const card = sent.slice(before).find((m) => m.method === 'sendMessage')
  return { res, cardText: card ? plain(card.body.text) : '' }
}
async function pressOk() {
  const { data } = await db.from('bot_proposals').select('id').eq('chat_id', CHAT).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).single()
  return resolveProposal(db, data!.id, 'ok', CHAT, { chatId: CHAT, messageId: 1, text: '', accessible: false }, {})
}
const cabinsOf = async (tripId: string) => (await db.from('cabins').select('id, cabin_number, deck, bed_type, price, max_guests, status, guests').eq('trip_id', tripId).order('cabin_number')).data ?? []

// a tiny real PNG in the inbox, like a photo the bot received
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const photoPath = 'inbox/test-setup-photo.png'
await db.storage.from('yacht-photos').upload(photoPath, new Blob([png], { type: 'image/png' }), { upsert: true })
const photoUrl = PHOTO_PREFIX + 'test-setup-photo.png'

let tripId = '', yachtId = ''
try {
  // 1. New trip + new yacht + cabins + photo in one card
  const t0 = Date.now()
  const { res, cardText } = await propose({
    summary: 'Тестовый тур',
    new_trip: { name: 'ТЕСТ тур setup', start_date: '2020-01-04', end_date: '2020-01-11', access_code: CODE, description: 'проверка' },
    new_yachts: [{ name: YACHT, description: 'тестовая' }],
    add_cabins: [
      { trip: 'new', yacht: YACHT, cabin_number: '1', deck: 'Main Deck', bed_type: 'Twin', price: 3400, max_guests: 2, status: 'Available' },
      { trip: 'new', yacht: YACHT, cabin_number: '2', deck: 'Upper Deck', bed_type: 'Double', price: 3700, max_guests: 2, status: 'Available' },
      { trip: 'new', yacht: YACHT, cabin_number: '3', deck: 'Lower Deck', bed_type: 'Twin', price: 0, max_guests: 4, status: 'STAFF' },
    ],
    photos: [{ url: photoUrl, yacht: YACHT, kind: 'photo' }, { url: photoUrl, yacht: YACHT, kind: 'deck_plan' }],
  })
  check('карточка нового тура отправлена', res.cardSent, res.cardSent ? '' : res.text)
  console.log(cardText.replace(/^/gm, '   '))
  const outcome = await pressOk()
  const { data: trip } = await db.from('trips').select('id, name, access_code, status').eq('access_code', CODE).maybeSingle()
  const { data: yacht } = await db.from('yachts').select('id, photos_urls, deck_plan_urls').eq('name', YACHT).maybeSingle()
  tripId = trip?.id ?? ''; yachtId = yacht?.id ?? ''
  const cabins = tripId ? await cabinsOf(tripId) : []
  check('«Ок» создал тур, лодку, 3 каюты, фото и план', !!trip && !!yacht && cabins.length === 3 && yacht.photos_urls?.[0] === photoUrl && yacht.deck_plan_urls?.[0] === photoUrl,
    `${((Date.now() - t0) / 1000).toFixed(1)} с; ${outcome?.split('\n')[0]}`)

  // 2. Validation: refused before any card
  const refusals: [string, Partial<SetupInput>][] = [
    ['каюта с таким номером уже есть', { summary: 'x', add_cabins: [{ trip: tripId, yacht: yachtId, cabin_number: '1', deck: 'Main Deck', bed_type: 'Twin', price: 1, max_guests: 2, status: 'Available' }] }],
    ['тип кровати не из списка', { summary: 'x', add_cabins: [{ trip: tripId, yacht: yachtId, cabin_number: '9', deck: 'Main Deck', bed_type: 'Double (джакузи)', price: 1, max_guests: 2, status: 'Available' }] }],
    ['чужая ссылка на фото', { summary: 'x', photos: [{ url: 'https://evil.example/x.jpg', yacht: yachtId, kind: 'photo' }] }],
    ['занятый код ссылки', { summary: 'x', new_trip: { name: 'y', start_date: '2020-02-01', end_date: '2020-02-02', access_code: CODE, description: null } }],
    ['лодка с таким именем уже есть', { summary: 'x', new_yachts: [{ name: YACHT, description: null }] }],
  ]
  const [r1, , r3] = cabins
  const keep = { deck: null, bed_type: null, price: null, max_guests: null }
  refusals.push(['перенумерация в уже занятый номер (без add_cabins)', { summary: 'x', cabin_updates: [{ cabin_id: r3.id, cabin_number: '1', ...keep }] }])
  refusals.push(['два номера сходятся в один', { summary: 'x', cabin_updates: [{ cabin_id: r1.id, cabin_number: '5', ...keep }, { cabin_id: r3.id, cabin_number: '5', ...keep }] }])
  refusals.push(['ненастоящая дата', { summary: 'x', new_trip: { name: 'y', start_date: '2020-02-30', end_date: '2020-03-02', access_code: 'test-setup-x', description: null } }])
  for (const [name, input] of refusals) {
    const { res } = await propose(input)
    check(`отказ: ${name}`, !res.cardSent && res.text.startsWith('Ошибка'), res.text.slice(0, 90))
  }

  // 3. Prices, swap of numbers, delete an empty cabin, yacht description — one card
  const [c1, c2, c3] = cabins
  await db.from('cabins').update({ guests: 'Тест Гость' }).eq('id', c1.id)
  const occupied = await propose({ summary: 'x', delete_cabins: [c1.id] })
  check('отказ: удалить каюту, где живут', !occupied.res.cardSent, occupied.res.text.slice(0, 90))
  await db.from('cabins').update({ status: 'Booked' }).eq('id', c3.id)
  const booked = await propose({ summary: 'x', delete_cabins: [c3.id] })
  check('отказ: удалить забронированную каюту без имён', !booked.res.cardSent, booked.res.text.slice(0, 90))
  await db.from('cabins').update({ status: 'STAFF' }).eq('id', c3.id)
  const upd = await propose({
    summary: 'Цены и номера',
    cabin_updates: [
      { cabin_id: c1.id, cabin_number: '2', deck: null, bed_type: null, price: 3500, max_guests: null },
      { cabin_id: c2.id, cabin_number: '1', deck: null, bed_type: 'Double/Twin', price: null, max_guests: null },
    ],
    delete_cabins: [c3.id],
    yacht_updates: [{ yacht_id: yachtId, name: null, description: 'новое описание' }],
  })
  check('карточка правок отправлена', upd.res.cardSent, upd.res.cardSent ? '' : upd.res.text)
  console.log(upd.cardText.replace(/^/gm, '   '))
  await pressOk()
  const after = await cabinsOf(tripId)
  const n1 = after.find((c) => c.id === c1.id), n2 = after.find((c) => c.id === c2.id)
  const { data: y2 } = await db.from('yachts').select('description').eq('id', yachtId).single()
  check('применено: обмен номеров, цена, кровать, удаление, описание',
    after.length === 2 && n1?.cabin_number === '2' && Number(n1?.price) === 3500 && n2?.cabin_number === '1' && n2?.bed_type === 'Double/Twin' && y2?.description === 'новое описание')

  // 4. Conflict: price changed while the card waited → nothing applied
  const conf = await propose({ summary: 'Цена', cabin_updates: [{ cabin_id: c2.id, cabin_number: null, deck: null, bed_type: null, price: 4000, max_guests: null }, { cabin_id: c1.id, cabin_number: null, deck: 'Sun Deck', bed_type: null, price: null, max_guests: null }] })
  await db.from('cabins').update({ price: 3900 }).eq('id', c2.id)
  const confOutcome = await pressOk()
  const { data: n1b } = await db.from('cabins').select('deck').eq('id', c1.id).single()
  check('конфликт: цену поменяли, пока карточка ждала → ничего не применено', conf.res.cardSent && (confOutcome ?? '').startsWith('Не применено') && n1b?.deck === 'Main Deck', (confOutcome ?? '').split('\n').slice(1).join(' '))

  // 5. A duplicate appears while the card waits → the DB's final check rolls the whole card back
  const dupCard = await propose({ summary: 'Номер', cabin_updates: [{ cabin_id: c2.id, cabin_number: '7', deck: null, bed_type: null, price: 3950, max_guests: null }] })
  await db.from('cabins').insert({ notion_id: crypto.randomUUID(), trip_id: tripId, yacht_id: yachtId, cabin_number: '7', status: 'Available', max_guests: 2 })
  const dupOutcome = await pressOk()
  const { data: c2after } = await db.from('cabins').select('cabin_number, price').eq('id', c2.id).single()
  const { data: dupProposal } = await db.from('bot_proposals').select('status').eq('chat_id', CHAT).order('created_at', { ascending: false }).limit(1).single()
  check('дубль номера появился, пока карточка ждала → откат целиком', dupCard.res.cardSent && (dupOutcome ?? '').includes('дважды') && c2after?.cabin_number === '1' && Number(c2after?.price) === 3900 && dupProposal?.status === 'conflict', dupOutcome ?? '')
} catch (err) {
  check('стенд упал', false, JSON.stringify(err).slice(0, 400))
} finally {
  if (tripId) { await db.from('cabins').delete().eq('trip_id', tripId); await db.from('trips').delete().eq('id', tripId) }
  if (yachtId) await db.from('yachts').delete().eq('id', yachtId)
  await db.from('bot_proposals').delete().eq('chat_id', CHAT)
  await db.storage.from('yacht-photos').remove([photoPath])
  console.log('\nубрано\n' + results.join('\n'))
  Deno.exit(results.some((r) => r.startsWith('❌')) ? 1 : 0)
}
