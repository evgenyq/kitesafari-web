// Shared TypeScript types for Supabase Edge Functions

export type BookingType = 'full_single' | 'full_double' | 'half' | 'join'

export type CabinStatus = 'Available' | 'Half Available' | 'Booked' | 'Paid' | 'Unavailable'

export type PaymentStatus = 'pending' | 'partial' | 'paid' | 'overpaid' | 'refund_due'

export type BookingStatus = 'active' | 'cancelled' | 'completed' | 'moved'

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
}

export interface CreateBookingResponse {
  success: boolean
  booking_id?: string
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

export interface BookingData {
  id: string
  trip_id: string
  cabin_id: string
  user_id: string
  guest_telegram_handle: string
  guest_full_name: string
  cabin_number: number
  cabin_deck: string
  cabin_bed_type: string
  cabin_price: number
  booking_type: BookingType
  payer_info: Record<string, any>
  total_amount: number
  paid_amount: number
  payment_status: PaymentStatus
  payment_deadline: string
  booking_status: BookingStatus
  guests_info?: string
  booking_source: string
  created_at: string
  updated_at: string
}
