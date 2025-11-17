import { useState } from 'react'
import type { BookingFormData, BookingType } from './types'
import styles from './EnterGuestsForm.module.css'

interface EnterGuestsFormProps {
  bookingType: BookingType
  formData: BookingFormData
  setFormData: (data: Partial<BookingFormData>) => void
  onNext: () => void
  onBack: () => void
}

export function EnterGuestsForm({
  bookingType,
  formData,
  setFormData,
  onNext,
  onBack,
}: EnterGuestsFormProps) {
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleChange = (field: keyof BookingFormData, value: string) => {
    setFormData({ [field]: value })
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }))
    }
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.guest_full_name.trim()) {
      newErrors.guest_full_name = 'Укажите ваше имя'
    }

    if (!formData.guest_telegram_handle.trim()) {
      newErrors.guest_telegram_handle = 'Укажите ваш Telegram handle'
    } else if (!formData.guest_telegram_handle.match(/^@?\w+$/)) {
      newErrors.guest_telegram_handle = 'Неверный формат Telegram handle'
    }

    // For full_double and join, second guest is required
    if (bookingType === 'full_double' || bookingType === 'join') {
      if (!formData.second_guest_name.trim()) {
        newErrors.second_guest_name = 'Укажите второго гостя'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleNext = () => {
    if (validate()) {
      onNext()
    }
  }

  const needsSecondGuest = bookingType === 'full_double' || bookingType === 'join'

  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Информация о гостях</h4>
        <p className={styles.hint}>
          Укажите информацию о{' '}
          {needsSecondGuest ? 'всех гостях каюты' : 'госте'}
        </p>
      </div>

      <div className={styles.form}>
        {/* Primary guest */}
        <div className={styles.field}>
          <label className={styles.label}>
            Ваше имя <span className={styles.required}>*</span>
          </label>
          <input
            type="text"
            className={`${styles.input} ${
              errors.guest_full_name ? styles.inputError : ''
            }`}
            placeholder="Иван Иванов"
            value={formData.guest_full_name}
            onChange={(e) => handleChange('guest_full_name', e.target.value)}
          />
          {errors.guest_full_name && (
            <span className={styles.error}>{errors.guest_full_name}</span>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>
            Ваш Telegram <span className={styles.required}>*</span>
          </label>
          <input
            type="text"
            className={`${styles.input} ${
              errors.guest_telegram_handle ? styles.inputError : ''
            }`}
            placeholder="@username"
            value={formData.guest_telegram_handle}
            onChange={(e) =>
              handleChange('guest_telegram_handle', e.target.value)
            }
          />
          {errors.guest_telegram_handle && (
            <span className={styles.error}>{errors.guest_telegram_handle}</span>
          )}
        </div>

        {/* Second guest for full_double and join */}
        {needsSecondGuest && (
          <div className={styles.field}>
            <label className={styles.label}>
              Второй гость <span className={styles.required}>*</span>
            </label>
            <input
              type="text"
              className={`${styles.input} ${
                errors.second_guest_name ? styles.inputError : ''
              }`}
              placeholder='Например: "жена", "Мария", "дети"'
              value={formData.second_guest_name}
              onChange={(e) => handleChange('second_guest_name', e.target.value)}
            />
            <p className={styles.fieldHint}>
              Можно указать имя или просто отношение (жена, дети, друг)
            </p>
            {errors.second_guest_name && (
              <span className={styles.error}>{errors.second_guest_name}</span>
            )}
          </div>
        )}

        {/* Optional payer info */}
        <div className={styles.field}>
          <label className={styles.label}>
            Информация об оплате (опционально)
          </label>
          <textarea
            className={styles.textarea}
            placeholder="Например: оплачу картой, нужен счет на компанию и т.д."
            rows={3}
            value={formData.payer_details}
            onChange={(e) => handleChange('payer_details', e.target.value)}
          />
        </div>
      </div>

      <div className={styles.actions}>
        <button className={styles.buttonSecondary} onClick={onBack}>
          Назад
        </button>
        <button className={styles.buttonPrimary} onClick={handleNext}>
          Далее
        </button>
      </div>
    </div>
  )
}
