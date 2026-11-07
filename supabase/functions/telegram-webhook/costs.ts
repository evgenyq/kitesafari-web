// Estimated OpenAI prices, USD. Checked 2026-11-07 (OpenAI help page for GPT-6.1; transcription per minute).
// Only for the bot_runs log — re-check when switching models.

const PER_MILLION: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-6.1-terra': { input: 1.0, cached: 0.05, output: 5.0 },
  'gpt-6.1-sol': { input: 2.0, cached: 0.1, output: 10.0 },
}
const TRANSCRIBE_PER_MINUTE: Record<string, number> = {
  'gpt-4o-transcribe': 0.006,
  'gpt-4o-mini-transcribe': 0.003,
}

export function tokenCost(model: string, input: number, cached: number, output: number): number | null {
  const p = PER_MILLION[model]
  if (!p) return null
  return ((input - cached) * p.input + cached * p.cached + output * p.output) / 1_000_000
}

export function transcribeCost(model: string, seconds: number): number | null {
  const p = TRANSCRIBE_PER_MINUTE[model]
  return p == null ? null : (seconds / 60) * p
}
