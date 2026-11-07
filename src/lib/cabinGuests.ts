// cabins.guests is not readable with the public key (migration 008):
// select these columns explicitly and get guest names from the cabin-guests Edge Function.
export const PUBLIC_CABIN_COLUMNS =
  'id, notion_id, trip_id, yacht_id, cabin_number, deck, bed_type, price, status, max_guests, created_at, updated_at'

/**
 * Guest names by cabin id. Admins get all cabins, other Telegram users only Half Available ones.
 * Outside Telegram or on any error returns {} — the UI just shows no names.
 */
export async function fetchCabinGuests(tripId: string): Promise<Record<string, string>> {
  const initData = window.Telegram?.WebApp?.initData
  if (!initData) return {}

  try {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cabin-guests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'X-Telegram-Init-Data': initData,
      },
      body: JSON.stringify({ trip_id: tripId }),
    })
    if (!response.ok) return {}
    const data = await response.json()
    return data.guests ?? {}
  } catch (err) {
    console.error('Error fetching cabin guests:', err)
    return {}
  }
}

/** Link to the Google Sheet live view; null for non-admins, outside Telegram or on error. */
export async function fetchSheetUrl(tripId: string): Promise<string | null> {
  const initData = window.Telegram?.WebApp?.initData
  if (!initData) return null

  try {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cabin-guests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'X-Telegram-Init-Data': initData,
      },
      body: JSON.stringify({ trip_id: tripId }),
    })
    if (!response.ok) return null
    const data = await response.json()
    return data.sheet_url ?? null
  } catch (err) {
    console.error('Error fetching sheet url:', err)
    return null
  }
}
