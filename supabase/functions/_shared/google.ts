// Google Sheets API access for Edge Functions via a service account.
// No Google SDK: sign a JWT, exchange it for an access token, call the REST API.
// Signing uses node-forge (pure JS): WebCrypto RSA sign fails in Supabase Edge Runtime 1.78
// with "PKCS#8 cryptographic key data malformed" (import works, sign doesn't; jose fails the same way).
// Secrets: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY (PEM, "\n" escapes allowed).

import forge from 'https://esm.sh/node-forge@1.3.1'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets'

let cached: { token: string; expiresAt: number } | null = null

// Input is a binary string (bytes as chars) or plain ASCII
const b64url = (data: string) =>
  btoa(data)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  const email = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL')
  const pem = Deno.env.get('GOOGLE_PRIVATE_KEY')
  if (!email || !pem) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY not configured')

  const key = forge.pki.privateKeyFromPem(pem.replace(/\\n/g, '\n'))

  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }))}`
  const md = forge.md.sha256.create()
  md.update(unsigned, 'utf8')
  const signature = key.sign(md)

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(signature)}`,
    }),
  })
  if (!response.ok) throw new Error(`Google token error ${response.status}: ${await response.text()}`)

  const { access_token, expires_in } = await response.json()
  cached = { token: access_token, expiresAt: Date.now() + expires_in * 1000 }
  return access_token
}

/** Call the Sheets API for one spreadsheet. `path` is appended to /spreadsheets/{id}, e.g. "/values/Sheet1!A1:G40". */
export async function sheetsApi<T = any>(spreadsheetId: string, path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken()
  const response = await fetch(`${SHEETS_URL}/${spreadsheetId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!response.ok) throw new Error(`Sheets API ${response.status} on ${path}: ${await response.text()}`)
  return response.json()
}
