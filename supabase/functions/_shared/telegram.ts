// Minimal Telegram Bot API client for Edge Functions.

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const API_BASE = Deno.env.get('TELEGRAM_API_BASE') || 'https://api.telegram.org' // overridden only by the local test harness
const MAX_TEXT = 4000 // Telegram limit is 4096

export async function tg<T = any>(method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API_BASE}/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const data = await response.json()
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`)
  return data.result
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Plain text message, split if too long. Returns the last sent message id. */
export async function sendText(chatId: number, text: string): Promise<number> {
  let last = 0
  for (let i = 0; i < text.length; i += MAX_TEXT) {
    last = (await tg('sendMessage', { chat_id: chatId, text: text.slice(i, i + MAX_TEXT) })).message_id
  }
  return last
}

export type InlineButton = { text: string; callback_data: string }

/** Download a file the bot received (voice, audio). Bot API serves files up to 20 MB. */
export async function downloadFile(fileId: string): Promise<Blob> {
  const file = await tg<{ file_path: string }>('getFile', { file_id: fileId })
  const response = await fetch(`${API_BASE}/file/bot${BOT_TOKEN}/${file.file_path}`)
  if (!response.ok) throw new Error(`Telegram file download ${response.status}`)
  return response.blob()
}
