// The bot's own messages to the organisers: new applications, due follow-ups, bookings made by guests.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { tg } from '../_shared/telegram.ts'

/**
 * Prefix of an event whose text was written by someone outside (a guest's words, a name from a Telegram profile,
 * a mini-app form). The organisers' agent gets such events as quoted data, never as instructions (agent.ts).
 */
export const FROM_OUTSIDE = '[от гостя] '

/** Send to every admin who takes notifications, and leave an event in their chat so the bot knows what it sent. */
export async function notifyAdmins(db: SupabaseClient, message: string, event: string, extra: Record<string, unknown> = {}): Promise<number> {
  const { data: admins, error } = await db.from('admin_users').select('telegram_id').eq('notify', true)
  if (error) throw error
  let sent = 0
  for (const admin of admins ?? []) {
    try {
      await tg('sendMessage', { chat_id: admin.telegram_id, text: message.slice(0, 4000), ...extra })
      await db.from('bot_messages').insert({ chat_id: admin.telegram_id, role: 'event', text: event.slice(0, 2000) })
      sent++
    } catch (err) {
      console.error('notify admin', admin.telegram_id, err)
    }
  }
  return sent
}
