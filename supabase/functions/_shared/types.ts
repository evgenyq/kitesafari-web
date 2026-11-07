// Shared TypeScript types for Supabase Edge Functions

export type BookingType = 'full_single' | 'full_double' | 'half' | 'join'

export type CabinStatus = 'Available' | 'Half Available' | 'Booked' | 'Paid' | 'Unavailable' | 'STAFF'

export interface CreateBookingRequest {
  trip_id: string
  cabin_id: string
  telegram_id?: number // Optional for admin override
  telegram_handle?: string // Optional for admin override
  full_name?: string // Optional for admin override
  booking_type?: BookingType // Optional for admin override
  guests_info?: string // For full_double: "@username Name, second_guest" OR admin free-text
  payer_details?: string // Optional payer information
  admin_override?: boolean // Admin mode: bypass validation, use free-text guests
  cabin_status?: CabinStatus // Admin mode: set specific cabin status
  expected_updated_at?: string // Admin mode: cabins.updated_at the admin saw, as-is; refuse (CONFLICT) if the cabin changed since
}

export interface CreateBookingResponse {
  success: boolean
  booking_id?: string // id of the notes row describing the booking (shown as booking number)
  total_amount?: number
  error?: string
  error_code?: string // For specific error handling
}

export interface CabinData {
  id: string
  cabin_number: number
  deck: string
  bed_type: string
  price: number
  status: CabinStatus
  max_guests: number
  guests?: string
  updated_at: string
}
