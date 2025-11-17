// Booking Modal types

export type BookingType = 'full_single' | 'full_double' | 'half' | 'join'

export type BookingStep = 'select_type' | 'enter_guests' | 'confirm' | 'success'

export interface BookingFormData {
  booking_type: BookingType | null
  guest_full_name: string
  guest_telegram_handle: string
  second_guest_name: string // For full_double: can be freetext like "жена", "дети"
  payer_details: string
}

export interface BookingStepProps {
  onNext: () => void
  onBack: () => void
  formData: BookingFormData
  setFormData: (data: Partial<BookingFormData>) => void
}
