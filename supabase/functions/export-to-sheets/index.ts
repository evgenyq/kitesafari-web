import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders } from '../_shared/cors.ts'
import { getAuthContext } from '../_shared/auth.ts'

const GOOGLE_SERVICE_ACCOUNT_EMAIL = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL')!
const GOOGLE_PRIVATE_KEY = Deno.env.get('GOOGLE_PRIVATE_KEY')!
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
    const { trip_id }: ExportRequest = await req.json()

    if (!trip_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing trip_id' }),
        {
          status: 400,
          headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
        }
      )
    }

    // REQUIRED: Validate Telegram authentication and admin privileges
    let authContext
    try {
      authContext = await getAuthContext(req)
    } catch (authError) {
      console.error('Auth error:', authError)
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication failed', error_code: 'AUTH_ERROR' }),
        {
          status: 401,
          headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
        }
      )
    }

    // Check admin privileges
    if (!authContext.isAdmin) {
      return new Response(
        JSON.stringify({ success: false, error: 'Admin privileges required', error_code: 'FORBIDDEN' }),
        {
          status: 403,
          headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
        }
      )
    }

    // Fetch bookings data
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: bookings, error: fetchError } = await supabase
      .from('bookings')
      .select(`
        id,
        cabin_number,
        guests_info,
        total_price,
        booking_type,
        booking_status,
        created_at,
        trips (
          trip_name,
          start_date,
          end_date
        )
      `)
      .eq('trip_id', trip_id)
      .eq('booking_status', 'active')
      .order('cabin_number', { ascending: true })

    if (fetchError) {
      throw fetchError
    }

    if (!bookings || bookings.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No bookings found' }),
        {
          status: 404,
          headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
        }
      )
    }

    // Get Google Sheets access token
    const accessToken = await getGoogleAccessToken()

    // Prepare data for sheets
    const tripInfo = bookings[0].trips as any
    const sheetName = `${tripInfo.trip_name} (${tripInfo.start_date})`

    // Create header row
    const rows = [
      ['Каюта', 'Гости', 'Тип бронирования', 'Цена (€)', 'Дата бронирования'],
      ...bookings.map((b: any) => [
        b.cabin_number,
        b.guests_info || '',
        b.booking_type,
        b.total_price,
        new Date(b.created_at).toLocaleDateString('ru-RU'),
      ]),
    ]

    // Write to Google Sheets
    await writeToGoogleSheets(accessToken, sheetName, rows)

    return new Response(
      JSON.stringify({
        success: true,
        message: `Exported ${bookings.length} bookings to Google Sheets`,
        sheet_url: `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}`,
      }),
      {
        headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Export error:', error)
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      {
        status: 500,
        headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
      }
    )
  }
})

async function getGoogleAccessToken(): Promise<string> {
  // Create JWT for Google OAuth
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  }

  const now = Math.floor(Date.now() / 1000)
  const claim = {
    iss: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }

  // Encode JWT
  const encoder = new TextEncoder()
  const headerB64 = btoa(JSON.stringify(header))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  const claimB64 = btoa(JSON.stringify(claim))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  const signatureInput = `${headerB64}.${claimB64}`

  // Import private key
  const privateKeyPem = GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
  const pemHeader = '-----BEGIN PRIVATE KEY-----'
  const pemFooter = '-----END PRIVATE KEY-----'
  const pemContents = privateKeyPem.substring(
    pemHeader.length,
    privateKeyPem.length - pemFooter.length
  ).replace(/\s/g, '')

  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0))

  const key = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // Sign JWT
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(signatureInput)
  )

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  const jwt = `${signatureInput}.${signatureB64}`

  // Exchange JWT for access token
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  const data = await response.json()
  return data.access_token
}

async function writeToGoogleSheets(
  accessToken: string,
  sheetName: string,
  rows: any[][]
) {
  // First, try to create the sheet (if it doesn't exist)
  try {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                },
              },
            },
          ],
        }),
      }
    )
  } catch (error) {
    // Sheet might already exist, continue
    console.log('Sheet might already exist:', error)
  }

  // Clear existing data and write new data
  const range = `${sheetName}!A1:Z1000`

  // Clear
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}:clear`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  )

  // Write
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: rows,
      }),
    }
  )
}
