// Edge Function: telegram-webhook — the @kitesafaribot entry point.
//   /start [access_code]   → anyone: button that opens the Mini App
//   admin text / forwards  → agent (agent.ts): reads the DB, proposes changes as cards
//   card buttons           → apply / cancel a proposal (proposals.ts)
// Telegram must send X-Telegram-Bot-Api-Secret-Token == TELEGRAM_WEBHOOK_SECRET (set via setWebhook);
// without the secret configured the function refuses everything (fail closed).
// Replies to Telegram immediately; the agent runs in the background (EdgeRuntime.waitUntil), one worker per chat.

import { timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { sendText, tg } from '../_shared/telegram.ts'
import { runAgent } from './agent.ts'
import { resolveProposal } from './proposals.ts'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

const MINI_APP_URL = Deno.env.get('MINI_APP_URL') || 'https://evgenyq.github.io/kitesafari-web/'
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')
const MAX_ROUNDS = 10 // safety cap on the worker loop

interface TgUser { id: number; first_name: string; last_name?: string; username?: string }
interface TgMessage {
  message_id: number
  date: number
  from?: TgUser
  chat: { id: number; type: string }
  text?: string
  caption?: string
  voice?: unknown
  audio?: unknown
  entities?: unknown[]
  forward_origin?: { type: string; sender_user?: TgUser; sender_user_name?: string; chat?: { title?: string }; date: number }
}
interface TgUpdate {
  update_id: number
  message?: TgMessage
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage }
}

const ok = () => new Response('ok')

function secretMatches(header: string | null): boolean {
  if (!WEBHOOK_SECRET || !header) return false
  const a = new TextEncoder().encode(header)
  const b = new TextEncoder().encode(WEBHOOK_SECRET)
  return a.length === b.length && timingSafeEqual(a, b)
}

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET) {
    console.error('TELEGRAM_WEBHOOK_SECRET is not configured — refusing all updates')
    return new Response('Not configured', { status: 500 })
  }
  if (!secretMatches(req.headers.get('x-telegram-bot-api-secret-token'))) return new Response('Forbidden', { status: 403 })

  try {
    const update: TgUpdate = await req.json()
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    if (update.callback_query) {
      EdgeRuntime.waitUntil(handleCallback(db, update.callback_query))
      return ok()
    }

    const message = update.message
    if (!message?.from || message.chat.type !== 'private') return ok()

    const text = message.text ?? message.caption ?? ''
    if (!message.forward_origin && text.startsWith('/start')) {
      const accessCode = text.split(' ')[1] ?? null
      EdgeRuntime.waitUntil(sendMiniAppButton(message.chat.id, accessCode).catch((e) => console.error('start:', e)))
      return ok()
    }

    if (!(await isAdmin(db, message.from.id))) {
      EdgeRuntime.waitUntil(sendText(message.chat.id, 'Я пока умею только открывать приложение с турами: нажмите /start').catch(() => {}))
      return ok()
    }

    if (message.voice || message.audio) {
      EdgeRuntime.waitUntil(sendText(message.chat.id, 'Голосовые научусь понимать совсем скоро — пока напишите текстом.').catch(() => {}))
      return ok()
    }
    if (!text.trim()) return ok()

    // Telegram re-delivers an update if we were slow to answer; the unique (chat_id, tg_message_id) drops repeats
    const { data: inserted, error } = await db
      .from('bot_messages')
      .upsert(
        { chat_id: message.chat.id, tg_message_id: message.message_id, role: 'user', text: describeIncoming(message, text), processed: false },
        { onConflict: 'chat_id,tg_message_id', ignoreDuplicates: true },
      )
      .select('id')
    if (error) {
      console.error('bot_messages insert:', error)
      EdgeRuntime.waitUntil(sendText(message.chat.id, 'Не смог сохранить сообщение, попробуйте ещё раз.').catch(() => {}))
      return ok()
    }
    if (!inserted?.length) return ok() // duplicate delivery

    EdgeRuntime.waitUntil(work(db, message.chat.id, message.from))
    return ok()
  } catch (error) {
    console.error('Error processing update:', error)
    return ok() // never make Telegram retry a broken update forever
  }
})

async function isAdmin(db: SupabaseClient, telegramId: number): Promise<boolean> {
  const { data } = await db.from('admin_users').select('telegram_id').eq('telegram_id', telegramId).maybeSingle()
  return !!data
}

/** Forwarded messages become "[Переслано от …]" so the model knows whose request it is. */
function describeIncoming(message: TgMessage, text: string): string {
  const origin = message.forward_origin
  if (!origin) return text
  const who = origin.sender_user
    ? [origin.sender_user.first_name, origin.sender_user.last_name].filter(Boolean).join(' ') + (origin.sender_user.username ? ` (@${origin.sender_user.username})` : '')
    : origin.sender_user_name ?? origin.chat?.title ?? 'неизвестно (скрыт)'
  const when = new Date(origin.date * 1000).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })
  return `[Переслано от ${who}, ${when}]\n${text}`
}

/**
 * One worker per chat: answers all unprocessed messages, repeats while new ones keep arriving.
 * Messages are marked processed only after the answer went out, so a killed worker leaves them for the next one.
 */
async function work(db: SupabaseClient, chatId: number, from: TgUser) {
  const { data: locked, error: lockError } = await db.rpc('bot_try_lock', { p_chat: chatId })
  if (lockError) {
    console.error('bot_try_lock:', lockError)
    await sendText(chatId, 'Не получилось взяться за сообщение, попробуйте ещё раз.').catch(() => {})
    return
  }
  if (!locked) return // the running worker will pick our message up

  const adminName = [from.first_name, from.last_name].filter(Boolean).join(' ')
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { data: pending, error } = await db.from('bot_messages').select('id').eq('chat_id', chatId).eq('processed', false).order('id')
      if (error) throw error

      if (pending?.length) {
        const ids = pending.map((m) => m.id)
        await tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {})
        const ctx: Parameters<typeof runAgent>[0] = { db, chatId, adminId: from.id, adminName }
        let reply: string
        try {
          reply = await runAgent(ctx, ids[ids.length - 1])
        } catch (err) {
          console.error('agent:', err)
          reply = 'Что-то сломалось, не смог обработать. Попробуйте ещё раз — или переформулируйте.'
        }
        // The model's next turn must know exactly what the card said, not just that one was sent
        if (ctx.cardPlain) await db.from('bot_messages').insert({ chat_id: chatId, role: 'assistant', text: `[Отправил карточку на подтверждение]\n${ctx.cardPlain}` })
        if (reply) {
          await sendText(chatId, reply)
          await db.from('bot_messages').insert({ chat_id: chatId, role: 'assistant', text: reply })
        }
        const { error: markError } = await db.from('bot_messages').update({ processed: true }).in('id', ids)
        if (markError) throw markError
      }

      const { data: released, error: releaseError } = await db.rpc('bot_release_lock', { p_chat: chatId })
      if (releaseError) throw releaseError
      if (released) return
    }
    throw new Error('worker round cap reached')
  } catch (err) {
    console.error('work:', err)
    await db.rpc('bot_force_unlock', { p_chat: chatId })
  }
}

const STATUS_RU: Record<string, string> = { applied: 'применено', cancelled: 'отменено', conflict: 'не применено из-за конфликта', superseded: 'устарело', missing: 'не найдено' }

async function handleCallback(db: SupabaseClient, cq: NonNullable<TgUpdate['callback_query']>) {
  const answer = (text?: string) => tg('answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: !!text }).catch(() => {})
  const [kind, proposalId, decision] = (cq.data ?? '').split(':')
  if (kind !== 'p' || !cq.message || !(decision === 'ok' || decision === 'no')) return answer()
  if (!(await isAdmin(db, cq.from.id))) return answer('Подтверждать могут только организаторы')

  try {
    const event = await resolveProposal(db, proposalId, decision, cq.from.id, {
      chatId: cq.message.chat.id,
      messageId: cq.message.message_id,
      text: cq.message.text ?? '',
      entities: cq.message.entities,
      accessible: cq.message.date !== 0, // Telegram sends date=0 for messages the bot can no longer access
    }, STATUS_RU)
    await answer()
    if (event) await db.from('bot_messages').insert({ chat_id: cq.message.chat.id, role: 'event', text: event })
  } catch (err) {
    console.error('callback:', err)
    await answer('Ошибка: изменения не применены. Напишите боту, что хотели сделать, — он предложит заново.')
    await db.from('bot_messages').insert({ chat_id: cq.message.chat.id, role: 'event', text: `Нажатие «${decision === 'ok' ? 'Ок' : 'Отмена'}» упало с ошибкой, ничего не применено: ${String(err).slice(0, 300)}` })
  }
}

async function sendMiniAppButton(chatId: number, accessCode: string | null) {
  // If access code provided, add it as URL parameter
  const url = accessCode ? `${MINI_APP_URL}?trip=${accessCode}` : MINI_APP_URL
  const text = accessCode
    ? `🏄 Добро пожаловать в KiteSafari!\n\n🎫 У вас есть доступ к новому трипу!\nНажмите кнопку чтобы открыть приложение:`
    : '🏄 Добро пожаловать в KiteSafari!\n\nВыберите трип и забронируйте каюту:'

  await tg('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: [[{ text: '🏄 Открыть KiteSafari', web_app: { url } }]] },
  })
}
