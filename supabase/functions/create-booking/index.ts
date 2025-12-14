// Edge Function: create-booking
// Purpose: Create cabin booking with Optimistic Locking for race condition protection
// Supports admin override mode for rebooking any cabin

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { getAuthContext } from '../_shared/auth.ts'
import type { CreateBookingRequest, CreateBookingResponse, CabinData, BookingType, CabinStatus } from '../_shared/types.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BOT_WEBHOOK_URL = Deno.env.get('BOT_WEBHOOK_URL') // Optional webhook for admin notifications

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    // Only allow POST
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const body: CreateBookingRequest = await req.json()
    const { trip_id, cabin_id, telegram_id, telegram_handle, full_name, booking_type, guests_info, payer_details, admin_override, cabin_status } = body

    // Get auth context (validates initData and checks admin status)
    let authContext
    try {
      authContext = await getAuthContext(req)
    } catch (authError) {
      console.error('Auth error:', authError)
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication failed', error_code: 'AUTH_ERROR' }),
        { status: 401, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
      )
    }

    // Check admin privileges if admin_override requested
    if (admin_override && !authContext.isAdmin) {
      return new Response(
        JSON.stringify({ success: false, error: 'Admin privileges required', error_code: 'FORBIDDEN' }),
        { status: 403, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
      )
    }

    // Validate required fields (different for admin vs normal)
    if (admin_override) {
      // Admin mode: only need cabin_id, trip_id, guests_info
      if (!trip_id || !cabin_id || !guests_info) {
        return new Response(
          JSON.stringify({ success: false, error: 'Missing required fields for admin mode', error_code: 'VALIDATION_ERROR' }),
          { status: 400, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
        )
      }
    } else {
      // Normal mode: need all booking fields
      if (!trip_id || !cabin_id || !telegram_id || !telegram_handle || !full_name || !booking_type) {
        return new Response(
          JSON.stringify({ success: false, error: 'Missing required fields', error_code: 'VALIDATION_ERROR' }),
          { status: 400, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
        )
      }

      // Validate booking type
      const validBookingTypes: BookingType[] = ['full_single', 'full_double', 'half', 'join']
      if (!validBookingTypes.includes(booking_type as BookingType)) {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid booking type', error_code: 'INVALID_BOOKING_TYPE' }),
          { status: 400, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
        )
      }
    }

    // Initialize Supabase client with service role key
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // ====================
    // ADMIN OVERRIDE MODE
    // ====================
    if (admin_override) {
      // Admin mode: skip normal booking logic, just update cabin directly

      // Get cabin details
      const { data: cabin, error: cabinError } = await supabase
        .from('cabins')
        .select('id, cabin_number, deck, bed_type, price, status, guests, updated_at')
        .eq('id', cabin_id)
        .single<CabinData>()

      if (cabinError || !cabin) {
        console.error('Error fetching cabin:', cabinError)
        return new Response(
          JSON.stringify({ success: false, error: 'Cabin not found', error_code: 'CABIN_NOT_FOUND' }),
          { status: 404, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
        )
      }

      // Update cabin with admin's guests_info and status
      const { error: updateError } = await supabase
        .from('cabins')
        .update({
          status: cabin_status || 'Booked', // Use provided status or default to Booked
          guests: guests_info || null, // Use null instead of empty string for cleaner DB
          updated_at: new Date().toISOString(),
        })
        .eq('id', cabin_id)

      if (updateError) {
        console.error('Error updating cabin:', updateError)
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to update cabin', error_code: 'CABIN_UPDATE_ERROR' }),
          { status: 500, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
        )
      }

      // Only create booking record for statuses that actually have bookings
      // Available and STAFF cabins don't need booking records
      let booking = null
      const needsBooking = cabin_status !== 'Available' && cabin_status !== 'STAFF'

      if (needsBooking) {
        const { data: bookingData } = await supabase
          .from('bookings')
          .insert({
            trip_id,
            cabin_id: cabin.id,
            user_id: null, // Placeholder - no specific user
            guest_telegram_handle: 'admin',
            guest_full_name: 'Admin Override',
            cabin_number: cabin.cabin_number,
            cabin_deck: cabin.deck,
            cabin_bed_type: cabin.bed_type,
            cabin_price: cabin.price,
            booking_type: 'full_double', // Default for admin
            payer_info: { type: 'admin', details: 'Manual admin booking' },
            total_amount: cabin.price,
            paid_amount: 0,
            payment_status: 'pending',
            payment_deadline: null,
            booking_status: 'active',
            guests_info,
            booking_source: 'admin',
            admin_booked_by: authContext.telegramId,
          })
          .select('id')
          .single()

        booking = bookingData
      }

      console.log(`✅ Admin override: ${authContext.telegramUsername || authContext.telegramId} set cabin ${cabin.cabin_number} to ${cabin_status || 'Booked'}`)

      return new Response(
        JSON.stringify({
          success: true,
          booking_id: booking?.id || null,
          total_amount: cabin.price,
          message: 'Cabin updated by admin',
        }),
        { status: 201, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
      )
    }

    // ====================
    // NORMAL BOOKING MODE
    // ====================

    // Step 1: Get or create user by telegram_id
    let { data: users, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', telegram_id)
      .limit(1)

    if (userError) {
      console.error('Error fetching user:', userError)
      return new Response(
        JSON.stringify({ success: false, error: 'Database error', error_code: 'DB_ERROR' }),
        { status: 500, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
      )
    }

    let user_id: string

    if (!users || users.length === 0) {
      // User doesn't exist, create new user
      const clean_handle = telegram_handle.startsWith('@') ? telegram_handle.slice(1) : telegram_handle
      const name_parts = full_name.split(' ')
      const first_name = name_parts[0] || ''
      const last_name = name_parts.slice(1).join(' ') || ''

      const { data: newUser, error: createUserError } = await supabase
        .from('users')
        .insert({
          telegram_id,
          username: clean_handle,
          first_name,
          last_name,
        })
        .select('id')
        .single()

      if (createUserError || !newUser) {
        console.error('Error creating user:', createUserError)
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to create user', error_code: 'USER_CREATE_ERROR' }),
          { status: 500, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
        )
      }

      user_id = newUser.id
    } else {
      user_id = users[0].id
    }

    // Step 2: Get cabin details with current status
    const { data: cabin, error: cabinError } = await supabase
      .from('cabins')
      .select('id, cabin_number, deck, bed_type, price, status, guests, max_guests, updated_at')
      .eq('id', cabin_id)
      .single<CabinData>()

    if (cabinError || !cabin) {
      console.error('Error fetching cabin:', cabinError)
      return new Response(
        JSON.stringify({ success: false, error: 'Cabin not found', error_code: 'CABIN_NOT_FOUND' }),
        { status: 404, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
      )
    }

    // Step 3: Validate cabin availability based on booking type
    const currentStatus = cabin.status

    if (booking_type === 'join') {
      // For join, cabin must be "Half Available"
      if (currentStatus !== 'Half Available') {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Cabin is not available for joining',
            error_code: 'CABIN_NOT_HALF_AVAILABLE',
            current_status: currentStatus
          }),
          { status: 409, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
        )
      }
    } else {
      // For other types, cabin must be "Available"
      if (currentStatus !== 'Available') {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Cabin is not available',
            error_code: 'CABIN_NOT_AVAILABLE',
            current_status: currentStatus
          }),
          { status: 409, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
        )
      }
    }

    // Step 4: Calculate booking details
    const cabin_price = cabin.price
    let total_amount: number
    let new_cabin_status: CabinStatus
    let guests_to_set: string

    if (booking_type === 'full_single') {
      total_amount = cabin_price
      new_cabin_status = 'Booked'
      guests_to_set = guests_info || `${telegram_handle} ${full_name}`
    } else if (booking_type === 'full_double') {
      total_amount = cabin_price
      new_cabin_status = 'Booked'
      guests_to_set = guests_info || `${telegram_handle} ${full_name}`
    } else if (booking_type === 'half') {
      total_amount = cabin_price / 2
      new_cabin_status = 'Half Available'
      guests_to_set = guests_info || `${telegram_handle} ${full_name}`
    } else { // join
      total_amount = cabin_price / 2
      new_cabin_status = 'Booked'
      // For join, append new guest to existing guests
      const current_guests = cabin.guests || ''
      guests_to_set = current_guests.trim()
        ? `${current_guests}, ${telegram_handle} ${full_name}`
        : `${telegram_handle} ${full_name}`
    }

    // Step 5: Create booking record
    const payment_deadline = new Date()
    payment_deadline.setDate(payment_deadline.getDate() + 14) // 14 days to pay

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .insert({
        trip_id,
        cabin_id: cabin.id,
        user_id,
        guest_telegram_handle: telegram_handle,
        guest_full_name: full_name,
        cabin_number: cabin.cabin_number,
        cabin_deck: cabin.deck,
        cabin_bed_type: cabin.bed_type,
        cabin_price,
        booking_type,
        payer_info: { type: 'self', details: payer_details || '' },
        total_amount,
        paid_amount: 0,
        payment_status: 'pending',
        payment_deadline: payment_deadline.toISOString(),
        booking_status: 'active',
        guests_info: guests_info || null,
        booking_source: 'miniapp',
      })
      .select('id')
      .single()

    if (bookingError || !booking) {
      console.error('Error creating booking:', bookingError)
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to create booking', error_code: 'BOOKING_CREATE_ERROR' }),
        { status: 500, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
      )
    }

    const booking_id = booking.id

    // Step 6: Update cabin with Optimistic Locking
    // This is the critical part - we only update if the status hasn't changed
    const { data: updatedCabin, error: updateError } = await supabase
      .from('cabins')
      .update({
        status: new_cabin_status,
        guests: guests_to_set,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cabin_id)
      .eq('status', currentStatus) // Optimistic Lock: only update if status is still the same
      .select('id')

    if (updateError) {
      console.error('Error updating cabin:', updateError)
      // Rollback: delete the booking
      await supabase.from('bookings').delete().eq('id', booking_id)
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update cabin', error_code: 'CABIN_UPDATE_ERROR' }),
        { status: 500, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
      )
    }

    // Check if cabin was actually updated (Optimistic Lock check)
    if (!updatedCabin || updatedCabin.length === 0) {
      // Status changed between our read and update - race condition detected!
      console.warn(`Race condition detected for cabin ${cabin_id}. Status changed from ${currentStatus}`)

      // Rollback: delete the booking
      await supabase.from('bookings').delete().eq('id', booking_id)

      return new Response(
        JSON.stringify({
          success: false,
          error: 'Cabin was just booked by someone else',
          error_code: 'RACE_CONDITION',
          previous_status: currentStatus
        }),
        { status: 409, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
      )
    }

    // Step 7: Send webhook notification to bot (optional, non-blocking)
    if (BOT_WEBHOOK_URL) {
      try {
        await fetch(BOT_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'booking_created',
            booking_id,
            telegram_id,
            telegram_handle,
            full_name,
            cabin_number: cabin.cabin_number,
            deck: cabin.deck,
            booking_type,
            total_amount,
          }),
        })
      } catch (webhookError) {
        // Log but don't fail the booking if webhook fails
        console.error('Webhook notification failed:', webhookError)
      }
    }

    // Success!
    console.log(`✅ Booking created: ${booking_id} - ${telegram_handle} in cabin ${cabin.cabin_number}`)

    const response: CreateBookingResponse = {
      success: true,
      booking_id,
      total_amount,
    }

    return new Response(
      JSON.stringify(response),
      { status: 201, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error', error_code: 'INTERNAL_ERROR' }),
      { status: 500, headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
    )
  }
})
