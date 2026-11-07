// Edge Function: create-booking
// Purpose: Book a cabin from the mini-app (optimistic locking against races)
// or let an admin set a cabin's guests/status directly (admin override).
// cabins is the only source of truth; who/when lands in cabin_changes via a trigger
// (we set cabins.changed_by), mini-app booking details go to notes.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { getAuthContext } from '../_shared/auth.ts'
import type { CreateBookingRequest, CreateBookingResponse, CabinData, BookingType, CabinStatus } from '../_shared/types.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const BOOKING_TYPE_LABELS: Record<BookingType, string> = {
  full_single: 'каюта целиком, один',
  full_double: 'каюта целиком, вдвоём',
  half: 'половина каюты',
  join: 'подселение',
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const headers = { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' }
  const reply = (body: CreateBookingResponse & Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(body), { status, headers })

  try {
    // Only allow POST
    if (req.method !== 'POST') {
      return reply({ success: false, error: 'Method not allowed' }, 405)
    }

    // Parse request body
    const body: CreateBookingRequest = await req.json()
    const { trip_id, cabin_id, telegram_id, telegram_handle, full_name, booking_type, guests_info, payer_details, admin_override, cabin_status, expected_updated_at } = body

    // Get auth context (validates initData and checks admin status)
    let authContext
    try {
      authContext = await getAuthContext(req)
    } catch (authError) {
      console.error('Auth error:', authError)
      return reply({ success: false, error: 'Authentication failed', error_code: 'AUTH_ERROR' }, 401)
    }

    // Check admin privileges if admin_override requested
    if (admin_override && !authContext.isAdmin) {
      return reply({ success: false, error: 'Admin privileges required', error_code: 'FORBIDDEN' }, 403)
    }

    // Validate required fields (different for admin vs normal)
    if (admin_override) {
      // Admin mode: only need cabin_id, trip_id
      // guests_info is optional - can be empty for Available/STAFF statuses
      if (!trip_id || !cabin_id) {
        return reply({ success: false, error: 'Missing required fields for admin mode', error_code: 'VALIDATION_ERROR' }, 400)
      }
    } else {
      // Normal mode: need all booking fields
      if (!trip_id || !cabin_id || !telegram_id || !telegram_handle || !full_name || !booking_type) {
        return reply({ success: false, error: 'Missing required fields', error_code: 'VALIDATION_ERROR' }, 400)
      }

      // Validate booking type
      if (!(booking_type in BOOKING_TYPE_LABELS)) {
        return reply({ success: false, error: 'Invalid booking type', error_code: 'INVALID_BOOKING_TYPE' }, 400)
      }
    }

    // Initialize Supabase client with service role key
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // ====================
    // ADMIN OVERRIDE MODE
    // ====================
    if (admin_override) {
      const { data: cabin, error: cabinError } = await supabase
        .from('cabins')
        .select('id, cabin_number, deck, bed_type, price, status, guests, max_guests, updated_at')
        .eq('id', cabin_id)
        .single<CabinData>()

      if (cabinError || !cabin) {
        console.error('Error fetching cabin:', cabinError)
        return reply({ success: false, error: 'Cabin not found', error_code: 'CABIN_NOT_FOUND' }, 404)
      }

      // Optimistic lock: the admin edited the cabin as of expected_updated_at (sent as-is, full precision);
      // any write since then (guests, status, anything) makes the update match no rows.
      const conflict = () => reply({
        success: false,
        error: 'Cabin was changed by someone else',
        error_code: 'CONFLICT',
        current_guests: cabin.guests ?? '',
        current_status: cabin.status,
      }, 409)
      const lockedAt = expected_updated_at ?? cabin.updated_at
      if (lockedAt !== cabin.updated_at) return conflict()

      const finalStatus = cabin_status || 'Booked'
      const { data: updated, error: updateError } = await supabase
        .from('cabins')
        .update({
          status: finalStatus,
          guests: guests_info || null,
          changed_by: `admin:${authContext.telegramId}`,
        })
        .eq('id', cabin_id)
        .eq('updated_at', lockedAt)
        .select('id')

      if (updateError) {
        console.error('Error updating cabin:', updateError)
        return reply({ success: false, error: 'Failed to update cabin', error_code: 'CABIN_UPDATE_ERROR' }, 500)
      }
      if (!updated || updated.length === 0) return conflict()

      console.log(`✅ Admin override: ${authContext.telegramUsername || authContext.telegramId} set cabin ${cabin.cabin_number} to ${finalStatus}`)

      return reply({ success: true, total_amount: cabin.price, message: 'Cabin updated by admin' }, 201)
    }

    // ====================
    // NORMAL BOOKING MODE
    // ====================

    // Validated above for normal mode
    const handle = telegram_handle!
    const name = full_name!

    // Step 1: Make sure we know this Telegram user (lets the bot write to them later); existing users are left as is
    const name_parts = name.split(' ')
    const { error: userError } = await supabase
      .from('users')
      .upsert({
        telegram_id,
        username: handle.startsWith('@') ? handle.slice(1) : handle,
        first_name: name_parts[0] || '',
        last_name: name_parts.slice(1).join(' ') || '',
      }, { onConflict: 'telegram_id', ignoreDuplicates: true })

    if (userError) {
      console.error('Error saving user:', userError)
      return reply({ success: false, error: 'Failed to save user', error_code: 'USER_CREATE_ERROR' }, 500)
    }

    // Step 2: Get cabin details with current status
    const { data: cabin, error: cabinError } = await supabase
      .from('cabins')
      .select('id, cabin_number, deck, bed_type, price, status, guests, max_guests, updated_at')
      .eq('id', cabin_id)
      .single<CabinData>()

    if (cabinError || !cabin) {
      console.error('Error fetching cabin:', cabinError)
      return reply({ success: false, error: 'Cabin not found', error_code: 'CABIN_NOT_FOUND' }, 404)
    }

    // Step 3: Validate cabin availability based on booking type
    const currentStatus = cabin.status

    if (booking_type === 'join') {
      // For join, cabin must be "Half Available"
      if (currentStatus !== 'Half Available') {
        return reply({
          success: false,
          error: 'Cabin is not available for joining',
          error_code: 'CABIN_NOT_HALF_AVAILABLE',
          current_status: currentStatus,
        }, 409)
      }
    } else if (currentStatus !== 'Available') {
      // For other types, cabin must be "Available"
      return reply({
        success: false,
        error: 'Cabin is not available',
        error_code: 'CABIN_NOT_AVAILABLE',
        current_status: currentStatus,
      }, 409)
    }

    // Step 4: Calculate booking details
    const guest = `${handle} ${name}`
    let total_amount: number
    let new_cabin_status: CabinStatus
    let guests_to_set: string

    if (booking_type === 'half') {
      total_amount = cabin.price / 2
      new_cabin_status = 'Half Available'
      guests_to_set = guests_info || guest
    } else if (booking_type === 'join') {
      total_amount = cabin.price / 2
      new_cabin_status = 'Booked'
      // For join, append new guest to existing guests
      const current_guests = cabin.guests || ''
      guests_to_set = current_guests.trim() ? `${current_guests}, ${guest}` : guest
    } else { // full_single, full_double
      total_amount = cabin.price
      new_cabin_status = 'Booked'
      guests_to_set = guests_info || guest
    }

    // Step 5: Update cabin with Optimistic Locking
    // Only update if the status hasn't changed since we read it
    const { data: updatedCabin, error: updateError } = await supabase
      .from('cabins')
      .update({
        status: new_cabin_status,
        guests: guests_to_set,
        changed_by: `miniapp:${telegram_id}`,
      })
      .eq('id', cabin_id)
      .eq('status', currentStatus)
      .eq('updated_at', cabin.updated_at) // also catches guest edits that kept the status (join builds on cabin.guests)
      .select('id')

    if (updateError) {
      console.error('Error updating cabin:', updateError)
      return reply({ success: false, error: 'Failed to update cabin', error_code: 'CABIN_UPDATE_ERROR' }, 500)
    }

    if (!updatedCabin || updatedCabin.length === 0) {
      // Cabin changed between our read and update - race condition detected!
      console.warn(`Race condition detected for cabin ${cabin_id}. Status changed from ${currentStatus}`)
      return reply({
        success: false,
        error: 'Cabin was just booked by someone else',
        error_code: 'RACE_CONDITION',
        previous_status: currentStatus,
      }, 409)
    }

    // Step 6: Leave the details in the notebook (who booked, how, payer). The cabin is already booked,
    // so a failure here is logged but doesn't fail the booking.
    const noteLines = [
      `Бронь через мини-апп: ${guest}, каюта ${cabin.cabin_number} (${cabin.deck}), ${BOOKING_TYPE_LABELS[booking_type as BookingType]}, ${total_amount}.`,
      guests_info && guests_info !== guests_to_set ? `Гости: ${guests_info}` : null,
      payer_details ? `Плательщик: ${payer_details}` : null,
    ].filter(Boolean)

    const { data: note, error: noteError } = await supabase
      .from('notes')
      .insert({
        trip_id,
        text: noteLines.join('\n'),
        created_by: `miniapp:${telegram_id}`,
        source: 'miniapp',
      })
      .select('id')
      .single()

    if (noteError) console.error('Error saving booking note:', noteError, '\nNote text:', noteLines.join('\n'))

    console.log(`✅ Booking: ${handle} in cabin ${cabin.cabin_number}`)

    return reply({ success: true, booking_id: note?.id, total_amount }, 201)

  } catch (error) {
    console.error('Unexpected error:', error)
    return reply({ success: false, error: 'Internal server error', error_code: 'INTERNAL_ERROR' }, 500)
  }
})
