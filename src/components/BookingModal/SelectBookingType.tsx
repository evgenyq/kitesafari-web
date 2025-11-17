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
      available: cabin.status === 'Available' && cabin.max_guests >= 2,
      description: getBookingTypeDescription('full_double', cabin_price),
    },
    {
      type: 'half',
      label: 'Половина каюты',
      available: cabin.status === 'Available' && cabin.max_guests >= 2,
      description: getBookingTypeDescription('half', cabin_price),
    },
    {
      type: 'join',
      label: 'Присоединиться',
      available: cabin.status === 'Half Available',
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
