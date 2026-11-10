// Due follow-ups: requests whose follow_up_at has come and notebook items whose remind_at has come.
// No model here — "due, open, not yet sent" is plain SQL, so nothing depends on a prompt remembering.
// The database pokes this only when something is due (migration 019); each item goes out once, with
// buttons to move the date or close it. Nothing due — nothing sent. A few per run (the rest go with the next
// one, 15 minutes later), so a slow Telegram cannot run the function out of time mid-way.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { tg } from '../_shared/telegram.ts'
import { notifyAdmins } from './notify.ts'

const day = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long' })
const buttons = (kind: 'r' | 'n', id: string, closeLabel: string) => ({
  inline_keyboard: [[
    { text: '+3 дня', callback_data: `f:${kind}:${id}:3` },
    { text: '+неделя', callback_data: `f:${kind}:${id}:7` },
    { text: closeLabel, callback_data: `f:${kind}:${id}:x` },
  ]],
})

export async function sendDueFollowUps(db: SupabaseClient): Promise<{ requests: number; notes: number }> {
  const now = new Date().toISOString()
  const [requests, notes] = await Promise.all([
    db.from('requests').select('id, state, follow_up_at, people(name, tg_username), trips(name)')
      .is('closed_at', null).is('follow_up_sent_at', null).lte('follow_up_at', now).order('follow_up_at').limit(8),
    db.from('notes').select('id, text, remind_at, trips(name)')
      .eq('status', 'open').is('reminded_at', null).lte('remind_at', now).order('remind_at').limit(8),
  ])
  if (requests.error) throw requests.error
  if (notes.error) throw notes.error

  let sentRequests = 0
  for (const r of (requests.data ?? []) as any[]) {
    // Claim first: two overlapping runs must not send the same reminder twice
    const { data: claimed } = await db.from('requests').update({ follow_up_sent_at: now }).eq('id', r.id).is('follow_up_sent_at', null).select('id')
    if (!claimed?.length) continue
    const who = `${r.people?.name ?? '?'}${r.people?.tg_username ? ` (@${r.people.tg_username})` : ''}`
    const text = `⏰ Пора вернуться: ${who} · ${r.trips?.name ?? 'без тура'}\n${r.state}\n\nСрок был ${day(r.follow_up_at)}.`
    // A failed send must not leave the item claimed: it would never be reminded of again
    const sent = await notifyAdmins(db, text, `Бот напомнил организатору о запросе: ${who}, ${r.trips?.name ?? 'без тура'} — ${r.state}`, { reply_markup: buttons('r', r.id, 'Закрыть запрос') })
      .catch((err) => { console.error('follow-up send:', err); return 0 })
    if (sent) sentRequests++
    else await db.from('requests').update({ follow_up_sent_at: null }).eq('id', r.id) // nobody got it: try again next time
  }
  let sentNotes = 0
  for (const n of (notes.data ?? []) as any[]) {
    const { data: claimed } = await db.from('notes').update({ reminded_at: now }).eq('id', n.id).is('reminded_at', null).select('id')
    if (!claimed?.length) continue
    const text = `⏰ Напоминание${n.trips?.name ? ` · ${n.trips.name}` : ''}\n${n.text}`
    const sent = await notifyAdmins(db, text, `Бот напомнил организатору о записи книжки: ${n.text}`, { reply_markup: buttons('n', n.id, 'Сделано') })
      .catch((err) => { console.error('reminder send:', err); return 0 })
    if (sent) sentNotes++
    else await db.from('notes').update({ reminded_at: null }).eq('id', n.id)
  }
  return { requests: sentRequests, notes: sentNotes }
}

/** A button under a reminder. Returns the outcome line (shown under the message and kept in the history). */
export async function resolveFollowUp(db: SupabaseClient, kind: string, id: string, action: string, adminId: number): Promise<string> {
  if (!['3', '7', 'x'].includes(action)) return 'Не понял кнопку.'
  const days = action === '3' ? 3 : action === '7' ? 7 : 0
  const later = new Date(Date.now() + days * 86400_000).toISOString()
  const actor = `bot:${adminId}`
  if (kind === 'r') {
    const { data: request } = await db.from('requests').select('id, closed_at, people(name)').eq('id', id).maybeSingle() as { data: any }
    if (!request) return 'Запроса уже нет.'
    if (request.closed_at) return 'Запрос уже закрыт.'
    const patch = days ? { follow_up_at: later } : { closed_at: new Date().toISOString(), follow_up_at: null }
    const { error } = await db.from('requests').update({ ...patch, changed_by: actor }).eq('id', id)
    if (error) throw error
    return days ? `↪️ Напомню ${day(later)} (${request.people?.name ?? ''})` : `✔️ Запрос закрыт (${request.people?.name ?? ''})`
  }
  const { data: note } = await db.from('notes').select('id, status').eq('id', id).maybeSingle()
  if (!note) return 'Записи уже нет.'
  if (note.status !== 'open') return 'Запись уже закрыта.'
  const { error } = await db.from('notes').update(days ? { remind_at: later, reminded_at: null } : { status: 'done' }).eq('id', id)
  if (error) throw error
  return days ? `↪️ Напомню ${day(later)}` : '✔️ Сделано'
}

/** Append the outcome to the reminder and drop its buttons. */
export async function finishFollowUp(chatId: number, messageId: number, text: string, outcome: string) {
  await tg('editMessageText', { chat_id: chatId, message_id: messageId, text: `${text}\n\n${outcome}` })
    .catch(() => tg('sendMessage', { chat_id: chatId, text: outcome }).catch(() => {}))
}
