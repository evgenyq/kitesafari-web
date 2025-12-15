// Authentication utilities for Edge Functions
// Validates Telegram initData and checks admin status

import { createHmac } from 'node:crypto'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

export interface AuthContext {
  telegramId: number
  telegramUsername?: string
  isAdmin: boolean
}

/**
 * Validates Telegram initData signature and checks admin status
 * Returns authenticated user context
 * Throws error if validation fails
 */
export async function getAuthContext(req: Request): Promise<AuthContext> {
  const initData = req.headers.get('x-telegram-init-data')

  if (!initData) {
    throw new Error('Missing Telegram initData')
  }

  // Validate initData signature
  const telegramId = validateInitData(initData)

  // Check admin status
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: adminUser } = await supabase
    .from('admin_users')
    .select('telegram_username')
    .eq('telegram_id', telegramId)
    .single()

  return {
    telegramId,
    telegramUsername: adminUser?.telegram_username,
    isAdmin: !!adminUser,
  }
}

/**
 * Validates Telegram WebApp initData using HMAC-SHA256
 * Returns telegram_id if valid
 * Throws error if invalid signature or expired
 */
function validateInitData(initData: string): number {
  const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')

  if (!BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN not configured')
  }

  // Parse initData
  const urlParams = new URLSearchParams(initData)
  const hash = urlParams.get('hash')

  if (!hash) {
    throw new Error('Missing hash in initData')
  }

  // Remove hash from params for validation
  urlParams.delete('hash')

  // Check expiration (auth_date should be within last 24 hours)
  const authDate = urlParams.get('auth_date')
  if (authDate) {
    const authTimestamp = parseInt(authDate, 10)
    const now = Math.floor(Date.now() / 1000)
    const maxAge = 86400 // 24 hours

    if (now - authTimestamp > maxAge) {
      throw new Error('initData expired')
    }
  }

  // Create data-check-string (sorted params)
  const dataCheckString = Array.from(urlParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  // Calculate secret key
  const secretKey = createHmac('sha256', 'WebAppData')
    .update(BOT_TOKEN)
    .digest()

  // Calculate hash
  const calculatedHash = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex')

  // Verify hash
  if (calculatedHash !== hash) {
    throw new Error('Invalid initData signature')
  }

  // Extract and return telegram_id
  const userParam = urlParams.get('user')
  if (!userParam) {
    throw new Error('Missing user in initData')
  }

  const user = JSON.parse(userParam)

  if (!user.id) {
    throw new Error('Missing user.id in initData')
  }

  return user.id
}
