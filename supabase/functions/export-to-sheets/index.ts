import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders } from '../_shared/cors.ts'
import { getAuthContext } from '../_shared/auth.ts'

const GOOGLE_APPS_SCRIPT_URL = Deno.env.get('GOOGLE_APPS_SCRIPT_URL')!
const GOOGLE_APPS_SCRIPT_SECRET = Deno.env.get('GOOGLE_APPS_SCRIPT_SECRET')!
const GOOGLE_SHEET_ID = Deno.env.get('GOOGLE_SHEET_ID')!

interface ExportRequest {
  trip_id: string
}

interface Booking {
  id: string
  cabin_number: string
  guests_info: string
  total_price: number
  booking_type: string
  booking_status: string
  created_at: string
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(req.headers.get('origin')),
    })
  }

  try {
    console.log('[export-to-sheets] Request received')

    const { trip_id }: ExportRequest = await req.json()
    console.log('[export-to-sheets] trip_id:', trip_id)

    if (!trip_id) {
      console.error('[export-to-sheets] Missing trip_id')
      return new Response(
        JSON.stringify({ success: false, error: 'Missing trip_id' }),
        {
          status: 400,
          headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
        }
      )
    }

    // REQUIRED: Validate Telegram authentication and admin privileges
    console.log('[export-to-sheets] Validating authentication...')
    let authContext
    try {
      authContext = await getAuthContext(req)
      console.log('[export-to-sheets] Auth successful, user:', authContext.telegramId, 'isAdmin:', authContext.isAdmin)
    } catch (authError) {
      console.error('[export-to-sheets] Auth error:', authError)
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication failed', error_code: 'AUTH_ERROR', details: String(authError) }),
        {
          status: 401,
          headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
        }
      )
    }

    // Check admin privileges
    if (!authContext.isAdmin) {
      console.error('[export-to-sheets] User is not admin:', authContext.telegramId)
      return new Response(
        JSON.stringify({ success: false, error: 'Admin privileges required', error_code: 'FORBIDDEN' }),
        {
          status: 403,
          headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
        }
      )
    }

    console.log('[export-to-sheets] Admin validated, fetching bookings...')

    // Fetch bookings data
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Fetch all cabins for this trip (including available and STAFF)
    const { data: cabins, error: fetchError } = await supabase
      .from('cabins')
      .select(`
        cabin_number,
        deck,
        bed_type,
        price,
        status,
        guests,
        yachts (
          name
        )
      `)
      .eq('trip_id', trip_id)

    if (fetchError) {
      console.error('[export-to-sheets] Database error:', fetchError)
      throw fetchError
    }

    console.log('[export-to-sheets] Found cabins:', cabins?.length || 0)

    if (!cabins || cabins.length === 0) {
      console.log('[export-to-sheets] No cabins found for trip:', trip_id)
      return new Response(
        JSON.stringify({ success: false, error: 'No cabins found' }),
        {
          status: 404,
          headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
        }
      )
    }

    // Get trip info
    const { data: tripData } = await supabase
      .from('trips')
      .select('name, start_date')
      .eq('id', trip_id)
      .single()

    const sheetName = `${tripData?.name} (${tripData?.start_date})`

    // Sort cabins by yacht name and cabin number (as integer)
    const sortedCabins = [...cabins].sort((a: any, b: any) => {
      const yachtA = a.yachts?.name || ''
      const yachtB = b.yachts?.name || ''
      if (yachtA !== yachtB) {
        return yachtA.localeCompare(yachtB)
      }
      return parseInt(String(a.cabin_number)) - parseInt(String(b.cabin_number))
    })

    // Create header row with yacht info
    const rows = [
      ['Яхта', 'Номер каюты', 'Палуба', 'Тип каюты', 'Цена (€)', 'Гости'],
      ...sortedCabins.map((cabin: any) => {
        const yacht = cabin.yachts
        const guests = cabin.status === 'STAFF' ? 'STAFF' : (cabin.guests || '')
        const price = cabin.status === 'STAFF' ? 0 : cabin.price

        return [
          yacht?.name || '',
          cabin.cabin_number,
          cabin.deck || '',
          cabin.bed_type || '',
          price,
          guests,
        ]
      }),
    ]

    // Write to Google Sheets via Apps Script
    console.log('[export-to-sheets] Calling Google Apps Script, sheet:', sheetName, 'rows:', rows.length)
    const result = await writeToGoogleSheets(sheetName, rows)
    console.log('[export-to-sheets] Successfully written to Google Sheets via Apps Script')

    return new Response(
      JSON.stringify({
        success: true,
        message: `Exported ${cabins.length} cabins to Google Sheets`,
        sheet_url: `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}`,
      }),
      {
        headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('[export-to-sheets] Fatal error:', error)
    console.error('[export-to-sheets] Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    return new Response(
      JSON.stringify({
        success: false,
        error: String(error),
        error_type: error instanceof Error ? error.constructor.name : typeof error,
        error_message: error instanceof Error ? error.message : String(error)
      }),
      {
        status: 500,
        headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
      }
    )
  }
})

async function writeToGoogleSheets(
  sheetName: string,
  rows: any[][]
): Promise<string> {
  console.log('[export-to-sheets] Calling Google Apps Script webhook...')

  const response = await fetch(GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      secret: GOOGLE_APPS_SCRIPT_SECRET,
      sheetName,
      rows,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[export-to-sheets] Apps Script error:', response.status, errorText)
    throw new Error(`Apps Script failed: ${response.status} ${errorText}`)
  }

  const result = await response.json()

  if (!result.success) {
    console.error('[export-to-sheets] Apps Script returned error:', result.error)
    throw new Error(`Apps Script error: ${result.error}`)
  }

  console.log('[export-to-sheets] Data written via Apps Script, URL:', result.sheetUrl)
  return result.sheetUrl
}
