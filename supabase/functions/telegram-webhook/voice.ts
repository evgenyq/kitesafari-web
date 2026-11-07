// Voice messages → text (OpenAI transcription). The prompt carries yacht names and guest names of current
// trips so "Бисмарк", nicknames and surnames come out spelled the way they are in the cabins.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { downloadFile } from '../_shared/telegram.ts'
import { transcribeCost } from './costs.ts'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const MODEL = Deno.env.get('OPENAI_TRANSCRIBE_MODEL') || 'gpt-4o-transcribe'
export const MAX_VOICE_SECONDS = 300
const PROMPT_LIMIT = 900 // chars; the transcription prompt is meant to be short

async function vocabulary(db: SupabaseClient): Promise<string> {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  const [{ data: yachts }, { data: cabins }] = await Promise.all([
    db.from('yachts').select('name'),
    db.from('cabins').select('guests, trips!inner(end_date)').gte('trips.end_date', since).not('guests', 'is', null),
  ])
  const names = new Set<string>()
  for (const c of cabins ?? []) {
    for (const part of (c.guests as string).split(/[,+\n]/)) {
      const name = part.replace(/@\w+/g, '').replace(/\(.*?\)/g, '').trim()
      if (/^[A-ZА-ЯЁ]/.test(name) && name.length < 40) names.add(name)
    }
  }
  let prompt = `Кайт-сафари на яхтах ${(yachts ?? []).map((y) => y.name).join(', ')}. Каюта, палуба, Main Deck, Upper Deck, Sun Deck, Lower Deck, вейтлист, предоплата. Гости: `
  for (const name of names) {
    if (prompt.length + name.length + 2 > PROMPT_LIMIT) break
    prompt += `${name}, `
  }
  return prompt.replace(/, $/, '.')
}

/** Transcribe a Telegram voice/audio file; logs the run to bot_runs. Throws on failure. */
export async function transcribe(db: SupabaseClient, chatId: number, messageId: number, fileId: string, seconds: number): Promise<string> {
  const started = Date.now()
  let text = ''
  let failure: unknown = null
  try {
    const [audio, prompt] = await Promise.all([downloadFile(fileId), vocabulary(db)])
    const form = new FormData()
    form.append('file', audio, 'voice.ogg')
    form.append('model', MODEL)
    form.append('language', 'ru')
    form.append('prompt', prompt)
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    })
    const data = await response.json()
    if (data.error) throw new Error(`OpenAI transcription: ${data.error.message}`)
    text = (data.text ?? '').trim()
    if (!text) throw new Error('пустая расшифровка')
    return text
  } catch (err) {
    failure = err
    throw err
  } finally {
    const { error } = await db.from('bot_runs').insert({
      chat_id: chatId,
      kind: 'transcribe',
      message_id: messageId,
      model: MODEL,
      duration_ms: Date.now() - started,
      audio_seconds: seconds,
      cost_usd: transcribeCost(MODEL, seconds),
      result: text || null,
      error: failure ? String(failure).slice(0, 2000) : null,
    })
    if (error) console.error('bot_runs insert:', error)
  }
}
