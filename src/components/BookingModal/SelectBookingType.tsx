import { Cabin } from '../../types'
import { getBookingTypeDescription } from '../../lib/guestUtils'
import type { BookingFormData, BookingType } from './types'
import styles from './SelectBookingType.module.css'

interface SelectBookingTypeProps {
  cabin: Cabin
  formData: BookingFormData
  setFormData: (data: Partial<BookingFormData>) => void
  onNext: () => void
  onBack: () => void
}

interface BookingOption {
  type: BookingType
  label: string
  available: boolean
  description: string
}

export function SelectBookingType({
  cabin,
  formData,
  setFormData,
  onNext,
  onBack,
}: SelectBookingTypeProps) {
  const cabin_price = cabin.price

  // Check if cabin supports half/join bookings based on bed type
  const supportsHalfBooking = (): boolean => {
    const bedType = cabin.bed_type.toLowerCase().trim()

    // Double bed (одна двуспальная кровать) - нельзя бронировать половину
    // Проверяем что это именно "double" без "twin" и без "single"
    if (bedType === 'double') {
      return false
    }

    // Single bed (одна кровать) - нельзя бронировать половину
    if (bedType === 'single') {
      return false
    }

    // Twin, Double+Single и т.д. - можно бронировать половину
    return cabin.max_guests >= 2
  }

  // Check if cabin supports 2 guests
  const supportsDoubleOccupancy = (): boolean => {
    const bedType = cabin.bed_type.toLowerCase()

    // Single bed - только 1 человек
    if (bedType === 'single') {
      return false
    }

    return cabin.max_guests >= 2
  }

  // Determine which booking types are available
  const options: BookingOption[] = [
    {
      type: 'full_single',
      label: 'Полная каюта (1 человек)',
      available: cabin.status === 'Available' && cabin.max_guests >= 1,
      description: getBookingTypeDescription('full_single', cabin_price),
    },
    {
      type: 'full_double',
      label: 'Полная каюта (2 человека)',
      available: cabin.status === 'Available' && supportsDoubleOccupancy(),
      description: getBookingTypeDescription('full_double', cabin_price),
    },
    {
      type: 'half',
      label: 'Половина каюты',
      available: cabin.status === 'Available' && supportsHalfBooking(),
      description: getBookingTypeDescription('half', cabin_price),
    },
    {
      type: 'join',
      label: 'Присоединиться',
      available: cabin.status === 'Half Available' && supportsHalfBooking(),
      description: getBookingTypeDescription('join', cabin_price),
    },
  ]

  const availableOptions = options.filter((opt) => opt.available)

  const handleSelectType = (type: BookingType) => {
    setFormData({ booking_type: type })
  }

  const handleNext = () => {
    if (formData.booking_type) {
      onNext()
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.cabinInfo}>
        <h3 className={styles.cabinTitle}>Каюта #{cabin.cabin_number}</h3>
        <div className={styles.cabinDetails}>
          <span>{cabin.bed_type}</span>
          <span>•</span>
          <span>{cabin.deck}</span>
          <span>•</span>
          <span>€{cabin_price.toFixed(0)}</span>
        </div>

        {/* Show existing guests for Half Available cabins */}
        {cabin.status === 'Half Available' && cabin.guests && (
          <div className={styles.guestsInfo}>
            <strong>👥 С кем вы подселитесь:</strong> {cabin.guests}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Выберите тип бронирования</h4>

        <div className={styles.options}>
          {availableOptions.map((option) => (
            <button
              key={option.type}
              className={`${styles.option} ${
                formData.booking_type === option.type ? styles.selected : ''
              }`}
              onClick={() => handleSelectType(option.type)}
            >
              <div className={styles.optionHeader}>
                <span className={styles.optionLabel}>{option.label}</span>
                <span className={styles.optionRadio}>
                  {formData.booking_type === option.type && '✓'}
                </span>
              </div>
              <p className={styles.optionDescription}>{option.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.actions}>
        <button className={styles.buttonSecondary} onClick={onBack}>
          Отмена
        </button>
        <button
          className={styles.buttonPrimary}
          onClick={handleNext}
          disabled={!formData.booking_type}
        >
          Далее
        </button>
      </div>
    </div>
  )
}
