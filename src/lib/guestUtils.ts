// Guest formatting utilities (replicates Python bot logic)

/**
 * Format guests info based on booking type
 * Replicates logic from kitesafaribot/api/webhook.py:clean_guest_entry()
 */
export function formatGuestsInfo(
  telegram_handle: string,
  full_name: string,
  booking_type: string,
  second_guest_name?: string
): string {
  // Clean telegram handle (remove @ if present)
  const clean_handle = telegram_handle.startsWith('@')
    ? telegram_handle
    : `@${telegram_handle}`

  if (booking_type === 'full_single' || booking_type === 'half') {
    // Single guest
    return `${clean_handle} ${full_name}`
  }

  if (booking_type === 'full_double' || booking_type === 'join') {
    // Two guests
    if (second_guest_name && second_guest_name.trim()) {
      return `${clean_handle} ${full_name}, ${second_guest_name.trim()}`
    }
    // If no second guest provided, just return primary guest
    return `${clean_handle} ${full_name}`
  }

  return `${clean_handle} ${full_name}`
}

/**
 * Clean guest entry to remove duplicate @username mentions
 * Replicates Python bot's clean_guest_entry() function
 */
export function cleanGuestEntry(entry: string): string {
  if (!entry || entry.trim() === '') {
    return ''
  }

  // Find the first @username mention
  const match = entry.match(/@\w+/)
  if (!match) {
    return entry.trim()
  }

  const username = match[0]

  // Replace all occurrences of @username with empty string
  let cleaned = entry.split(username).join('')

  // Clean up extra commas and spaces
  cleaned = cleaned
    .replace(/,\s*,/g, ',') // Double commas
    .replace(/^\s*,\s*/, '') // Leading comma
    .replace(/\s*,\s*$/, '') // Trailing comma
    .replace(/\s+/g, ' ') // Multiple spaces
    .trim()

  // Put back the username at the start
  return `${username} ${cleaned}`
}

/**
 * Get booking type display name in Russian
 */
export function getBookingTypeDisplayName(booking_type: string): string {
  const names: Record<string, string> = {
    full_single: 'Полная каюта (1 человек)',
    full_double: 'Полная каюта (2 человека)',
    half: 'Половина каюты',
    join: 'Присоединиться к бронированию',
  }
  return names[booking_type] || booking_type
}

/**
 * Get booking type description
 */
export function getBookingTypeDescription(booking_type: string, cabin_price: number): string {
  const half_price = cabin_price / 2

  const descriptions: Record<string, string> = {
    full_single: `Полная каюта для одного человека. Стоимость: €${cabin_price.toFixed(0)}`,
    full_double: `Полная каюта для двух человек. Стоимость: €${cabin_price.toFixed(0)}`,
    half: `Половина каюты (второе место останется свободным для других). Стоимость: €${half_price.toFixed(0)}`,
    join: `Присоединение к существующему бронированию половины каюты. Стоимость: €${half_price.toFixed(0)}`,
  }
  return descriptions[booking_type] || ''
}
