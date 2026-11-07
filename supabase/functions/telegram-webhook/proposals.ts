// Proposals: changes the bot suggests and the admin confirms with a button.
// Cards show exact "было → станет"; applying is all-or-nothing in bot_apply_proposal() (migration 011).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { escapeHtml, tg } from '../_shared/telegram.ts'

export const STATUSES = ['Available', 'Half Available', 'Booked', 'Paid', 'Unavailable', 'STAFF'] as const
export const STATUS_RU: Record<string, string> = {
  'Available': 'свободна',
  'Half Available': 'половина свободна',
  'Booked': 'занята',
  'Paid': 'оплачена',
  'Unavailable': 'недоступна',
  'STAFF': 'STAFF',
}

const CARD_LIMIT = 3500 // leaves room for the outcome footer within Telegram's 4096
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ProposalInput {
  summary: string
  cabin_changes?: { cabin_id: string; new_guests?: string | null; new_status?: string | null }[]
  add_notes?: { text: string; trip_id?: string | null; remind_at?: string | null }[]
  close_notes?: string[]
}

type CabinRow = { id: string; cabin_number: string; guests: string | null; status: string; yachts: { name: string } | null; trips: { name: string } | null }

const cabinLabel = (c: CabinRow) => `${c.yachts?.name ?? '?'} #${c.cabin_number} (${c.trips?.name ?? ''})`
const shown = (s: string | null | undefined) => (s && s.trim() ? escapeHtml(s) : '<i>пусто</i>')
const blankToNull = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null)

/**
 * Validate, store and send a proposal card. Returns a short result for the model;
 * anything invalid comes back as an error text so the model can fix it instead of producing a broken card.
 */
export async function createProposal(db: SupabaseClient, chatId: number, adminId: number, input: ProposalInput): Promise<{ text: string; cardSent: boolean }> {
  const fail = (text: string) => ({ text: `Ошибка: ${text} Карточка не отправлена — исправь и предложи заново.`, cardSent: false })
  const actions: Record<string, unknown>[] = []
  const lines: string[] = [`<b>${escapeHtml(input.summary)}</b>`, '']

  const changes = input.cabin_changes ?? []
  if (changes.some((c) => !UUID.test(c.cabin_id))) return fail('cabin_id должен быть id каюты из контекста.')
  if (changes.length) {
    const { data: cabins, error } = await db
      .from('cabins')
      .select('id, cabin_number, guests, status, yachts(name), trips(name)')
      .in('id', changes.map((c) => c.cabin_id))
      .returns<CabinRow[]>()
    if (error) throw error
    const byId = new Map((cabins ?? []).map((c) => [c.id, c]))

    for (const change of changes) {
      const cabin = byId.get(change.cabin_id)
      if (!cabin) return fail(`каюты ${change.cabin_id} нет.`)
      const newStatusInput = blankToNull(change.new_status) // models send "" for "no change"
      if (newStatusInput && !STATUSES.includes(newStatusInput as typeof STATUSES[number])) {
        return fail(`статус "${newStatusInput}" недопустим (${STATUSES.join(', ')}).`)
      }
      const newGuests = change.new_guests ?? cabin.guests // "" = cabin becomes empty, null = keep
      const newStatus = newStatusInput ?? cabin.status
      if ((newGuests ?? '') === (cabin.guests ?? '') && newStatus === cabin.status) continue

      actions.push({
        type: 'cabin',
        cabin_id: cabin.id,
        expected_guests: cabin.guests ?? '',
        expected_status: cabin.status,
        new_guests: change.new_guests ?? null,
        new_status: newStatusInput,
      })
      lines.push(`🛏 <b>${escapeHtml(cabinLabel(cabin))}</b>`)
      if ((newGuests ?? '') !== (cabin.guests ?? '')) lines.push(`было: ${shown(cabin.guests)}`, `станет: ${shown(newGuests)}`)
      if (newStatus !== cabin.status) lines.push(`статус: ${STATUS_RU[cabin.status] ?? cabin.status} → ${STATUS_RU[newStatus] ?? newStatus}`)
      lines.push('')
    }
  }

  const notes = (input.add_notes ?? []).filter((n) => n.text?.trim())
  const tripIds = [...new Set(notes.map((n) => blankToNull(n.trip_id)).filter(Boolean))] as string[]
  if (tripIds.some((id) => !UUID.test(id))) return fail('trip_id должен быть id тура из контекста (или null).')
  if (tripIds.length) {
    const { data: trips, error } = await db.from('trips').select('id').in('id', tripIds)
    if (error) throw error
    if ((trips ?? []).length !== tripIds.length) return fail('такого тура нет.')
  }
  for (const note of notes) {
    const remind = blankToNull(note.remind_at)
    if (remind && Number.isNaN(Date.parse(remind))) return fail(`remind_at "${remind}" — не дата (нужен ISO, например 2026-12-15T10:00:00+03:00).`)
    actions.push({ type: 'add_note', text: note.text.trim(), trip_id: blankToNull(note.trip_id), remind_at: remind ? new Date(remind).toISOString() : null })
    const when = remind ? ` ⏰ ${new Date(remind).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' })}` : ''
    lines.push(`📝 Записать: ${escapeHtml(note.text.trim())}${when}`)
  }

  const closeIds = input.close_notes ?? []
  if (closeIds.some((id) => !UUID.test(id))) return fail('close_notes — это id записей из контекста.')
  if (closeIds.length) {
    const { data: open, error } = await db.from('notes').select('id, text').in('id', closeIds).eq('status', 'open')
    if (error) throw error
    for (const note of open ?? []) {
      actions.push({ type: 'close_note', note_id: note.id })
      lines.push(`✔️ Закрыть запись: ${escapeHtml(note.text.slice(0, 200))}`)
    }
  }

  if (!actions.length) return { text: 'Нечего менять: всё уже так. Карточка не отправлена.', cardSent: false }
  const cardText = lines.join('\n').trim()
  if (cardText.length > CARD_LIMIT) return fail('карточка слишком длинная для Telegram — разбей на несколько по очереди.')

  const { data: proposal, error } = await db
    .from('bot_proposals')
    .insert({ chat_id: chatId, created_by: adminId, summary: input.summary, actions })
    .select('id')
    .single()
  if (error) throw error

  let messageId: number
  try {
    messageId = (await tg('sendMessage', {
      chat_id: chatId,
      text: cardText,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[
        { text: '✅ Ок', callback_data: `p:${proposal.id}:ok` },
        { text: '✖️ Отмена', callback_data: `p:${proposal.id}:no` },
      ]] },
    })).message_id
  } catch (err) {
    await db.from('bot_proposals').update({ status: 'cancelled', resolved_at: new Date().toISOString() }).eq('id', proposal.id)
    return fail(`Telegram не принял карточку (${String(err).slice(0, 200)}).`)
  }

  // Only now the new card exists in the chat: older pending cards are no longer what the admin is looking at
  await db.from('bot_proposals').update({ tg_message_id: messageId }).eq('id', proposal.id)
  await db.from('bot_proposals').update({ status: 'superseded', resolved_at: new Date().toISOString() })
    .eq('chat_id', chatId).eq('status', 'pending').neq('id', proposal.id)

  return { text: 'Карточка отправлена, ждём «Ок». Не пересказывай её содержание.', cardSent: true }
}

export interface CardMessage { chatId: number; messageId: number; text: string; entities?: unknown[]; accessible: boolean }

/** Handle a button press on a card. Returns an event line for the conversation history. Throws on DB errors. */
export async function resolveProposal(db: SupabaseClient, proposalId: string, decision: 'ok' | 'no', adminId: number, card: CardMessage, statusRu: Record<string, string>): Promise<string | null> {
  // Keep the card as sent (text + formatting entities) and append the outcome; editing also removes the buttons.
  // A card the bot can no longer access (too old) gets the outcome as a new message instead.
  const finish = async (footer: string) => {
    const footerText = footer.length > 500 ? footer.slice(0, 497) + '…' : footer
    try {
      if (card.accessible && card.text) {
        await tg('editMessageText', { chat_id: card.chatId, message_id: card.messageId, text: `${card.text}\n\n${footerText}`, entities: card.entities })
      } else {
        await tg('sendMessage', { chat_id: card.chatId, text: footerText })
      }
    } catch (e) {
      console.error('finish card:', e)
      await tg('sendMessage', { chat_id: card.chatId, text: footerText }).catch(() => {})
    }
  }

  const { data: proposal, error } = await db.from('bot_proposals').select('summary, status').eq('id', proposalId).maybeSingle()
  if (error) throw error
  if (!proposal) return null
  if (proposal.status !== 'pending') {
    await finish(`Уже обработано: ${statusRu[proposal.status] ?? proposal.status}`)
    return null
  }

  if (decision === 'no') {
    const { data: cancelled, error: cancelError } = await db.from('bot_proposals')
      .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
      .eq('id', proposalId).eq('status', 'pending').select('id')
    if (cancelError) throw cancelError
    if (!cancelled?.length) {
      // An "Ок" won the race; report what really happened
      const { data: now } = await db.from('bot_proposals').select('status').eq('id', proposalId).maybeSingle()
      await finish(`Уже обработано: ${statusRu[now?.status ?? ''] ?? now?.status}`)
      return null
    }
    await finish('✖️ Отменено')
    return `Организатор отменил карточку «${proposal.summary}».`
  }

  const { data: result, error: applyError } = await db.rpc('bot_apply_proposal', { p_id: proposalId, p_actor: `bot:${adminId}` })
  if (applyError) throw applyError

  if (result.status === 'applied') {
    await finish('✅ Применено')
    return `Применено: «${proposal.summary}».`
  }
  if (result.status === 'conflict') {
    const details = await describeConflicts(db, result.conflicts)
    await finish(`⚠️ Не применено: пока карточка ждала, каюты изменились.\n${details}`)
    return `Не применено «${proposal.summary}»: каюты изменились, пока карточка ждала. Сейчас там:\n${details}`
  }
  await finish(`Уже обработано: ${statusRu[result.current] ?? result.current}`)
  return null
}

/** Plain text: goes into the edited card (no parse_mode) and into the history. */
async function describeConflicts(db: SupabaseClient, conflicts: { cabin_id: string; current_guests: string | null; current_status: string | null }[]): Promise<string> {
  const { data: cabins } = await db.from('cabins').select('id, cabin_number, yachts(name)').in('id', conflicts.map((c) => c.cabin_id))
  const names = new Map((cabins ?? []).map((c: any) => [c.id, `${c.yachts?.name ?? '?'} #${c.cabin_number}`]))
  return conflicts
    .map((c) => `• ${names.get(c.cabin_id) ?? c.cabin_id}: ${c.current_guests?.trim() || 'пусто'} (${STATUS_RU[c.current_status ?? ''] ?? c.current_status})`)
    .join('\n')
}
