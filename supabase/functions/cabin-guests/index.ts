// Edge Function: cabin-guests
// Purpose: cabins.guests is not readable with the public key (migration 008).
// Admins get guests for every cabin of the trip; other verified Telegram users
// only for Half Available cabins (the "who you'll share with" hint when joining).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { getAuthContext } from '../_shared/auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const headers = { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' }
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)

  let authContext
  try {
    authContext = await getAuthContext(req)
  } catch (authError) {
    console.error('Auth error:', authError)
    return reply({ error: 'Authentication failed', error_code: 'AUTH_ERROR' }, 401)
  }

  const { trip_id } = await req.json().catch(() => ({}))
  if (!trip_id) return reply({ error: 'trip_id is required' }, 400)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  let query = supabase.from('cabins').select('id, guests').eq('trip_id', trip_id).not('guests', 'is', null)
  if (!authContext.isAdmin) query = query.eq('status', 'Half Available')

  const { data, error } = await query
  if (error) {
    console.error('Fetch error:', error)
    return reply({ error: 'Failed to fetch guests' }, 500)
  }

  const guests: Record<string, string> = {}
  for (const row of data ?? []) guests[row.id] = row.guests
  const sheetId = Deno.env.get('GOOGLE_SHEET_ID')
  const sheet_url = authContext.isAdmin && sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}` : null
  return reply({ guests, is_admin: authContext.isAdmin, sheet_url })
})
