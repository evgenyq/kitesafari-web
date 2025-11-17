import { useState, useEffect } from 'react'
import { Cabin } from '../../types'
import { useTelegramWebApp } from '../../hooks/useTelegramWebApp'
import { useRealtimeCabin } from '../../hooks/useRealtimeCabin'
import { SelectBookingType } from './SelectBookingType'
import { EnterGuestsForm } from './EnterGuestsForm'
import { ConfirmBooking } from './ConfirmBooking'
import { BookingSuccess } from './BookingSuccess'
import type { BookingFormData, BookingStep } from './types'
import styles from './BookingModal.module.css'

interface BookingModalProps {
  cabin: Cabin
  trip_id: string
  isOpen: boolean
  onClose: () => void
}

export function BookingModal({ cabin, trip_id, isOpen, onClose }: BookingModalProps) {
  const { webApp, user } = useTelegramWebApp()

  // Realtime protection: monitor cabin status changes
  const { status: realtimeStatus, isStatusChanged } = useRealtimeCabin(
    isOpen ? cabin.id : null
  )

  const [currentStep, setCurrentStep] = useState<BookingStep>('select_type')
  const [formData, setFormData] = useState<BookingFormData>({
    booking_type: null,
    guest_full_name: user?.first_name && user?.last_name
      ? `${user.first_name} ${user.last_name}`
      : user?.first_name || '',
    guest_telegram_handle: user?.username ? `@${user.username}` : '',
    second_guest_name: '',
    payer_details: '',
  })
  const [bookingId, setBookingId] = useState<string>('')
  const [totalAmount, setTotalAmount] = useState<number>(0)

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setCurrentStep('select_type')
      setBookingId('')
      setTotalAmount(0)
    }
  }, [isOpen])

  // Realtime protection: close modal if cabin status changes during booking
  useEffect(() => {
    if (isStatusChanged && realtimeStatus) {
      // Don't close if we're on success screen (our own booking)
      if (currentStep === 'success') {
        return
      }

      // Check if status makes cabin unavailable
      const isNowUnavailable =
        (formData.booking_type === 'join' && realtimeStatus !== 'Half Available') ||
        (formData.booking_type !== 'join' && realtimeStatus !== 'Available')

      if (isNowUnavailable) {
        // Show Telegram notification if available
        if (webApp?.showPopup) {
          webApp.showPopup({
            title: 'Каюта недоступна',
            message: `Каюта #${cabin.cabin_number} только что была забронирована другим человеком. Пожалуйста, выберите другую каюту.`,
            buttons: [{ type: 'ok' }],
          }, () => {
            // Close modal and refresh page
            window.location.reload()
          })
        } else {
          // Fallback: just alert and close
          alert(
            `Каюта #${cabin.cabin_number} только что была забронирована другим человеком. Пожалуйста, выберите другую каюту.`
          )
          window.location.reload()
        }
      }
    }
  }, [isStatusChanged, realtimeStatus, formData.booking_type, cabin.cabin_number, currentStep, webApp])

  const updateFormData = (data: Partial<BookingFormData>) => {
    setFormData(prev => ({ ...prev, ...data }))
  }

  const handleNext = () => {
    if (currentStep === 'select_type') {
      // Skip guest form for 'half' type with only 1 guest
      if (formData.booking_type === 'half' || formData.booking_type === 'full_single') {
        setCurrentStep('confirm')
      } else {
        setCurrentStep('enter_guests')
      }
    } else if (currentStep === 'enter_guests') {
      setCurrentStep('confirm')
    }
  }

  const handleBack = () => {
    if (currentStep === 'confirm') {
      // Go back to guest form or type selection
      if (formData.booking_type === 'full_double' || formData.booking_type === 'join') {
        setCurrentStep('enter_guests')
      } else {
        setCurrentStep('select_type')
      }
    } else if (currentStep === 'enter_guests') {
      setCurrentStep('select_type')
    }
  }

  const handleBookingSuccess = (booking_id: string, total_amount: number) => {
    setBookingId(booking_id)
    setTotalAmount(total_amount)
    setCurrentStep('success')
  }

  const handleClose = () => {
    if (currentStep === 'success') {
      // Refresh page to show updated cabin status
      window.location.reload()
    } else {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>
            Бронирование каюты #{cabin.cabin_number}
          </h2>
          <button className={styles.closeButton} onClick={handleClose}>
            ✕
          </button>
        </div>

        <div className={styles.content}>
          {currentStep === 'select_type' && (
            <SelectBookingType
              cabin={cabin}
              formData={formData}
              setFormData={updateFormData}
              onNext={handleNext}
              onBack={onClose}
            />
          )}

          {currentStep === 'enter_guests' && (
            <EnterGuestsForm
              bookingType={formData.booking_type!}
              formData={formData}
              setFormData={updateFormData}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}

          {currentStep === 'confirm' && (
            <ConfirmBooking
              cabin={cabin}
              trip_id={trip_id}
              formData={formData}
              onSuccess={handleBookingSuccess}
              onBack={handleBack}
            />
          )}

          {currentStep === 'success' && (
            <BookingSuccess
              bookingId={bookingId}
              cabin={cabin}
              bookingType={formData.booking_type!}
              totalAmount={totalAmount}
              onClose={handleClose}
            />
          )}
        </div>
      </div>
    </div>
  )
}
