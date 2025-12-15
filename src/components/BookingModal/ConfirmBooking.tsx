import { useState } from 'react'
import { Cabin } from '../../types'
import { formatGuestsInfo, getBookingTypeDisplayName } from '../../lib/guestUtils'
import { formatPrice } from '../../lib/utils'
import type { BookingFormData } from './types'
import styles from './ConfirmBooking.module.css'

interface ConfirmBookingProps {
  cabin: Cabin
  trip_id: string
  formData: BookingFormData
  onSuccess: (booking_id: string, total_amount: number) => void
  onBack: () => void
}

export function ConfirmBooking({
  cabin,
  trip_id,
  formData,
  onSuccess,
  onBack,
}: ConfirmBookingProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const calculateTotalAmount = (): number => {
    if (
      formData.booking_type === 'half' ||
      formData.booking_type === 'join'
    ) {
      return cabin.price / 2
    }
    return cabin.price
  }

  const totalAmount = calculateTotalAmount()

  const guests_info = formatGuestsInfo(
    formData.guest_telegram_handle,
    formData.guest_full_name,
    formData.booking_type!,
    formData.second_guest_name
  )

  const handleConfirm = async () => {
    if (!formData.booking_type) {
      setError('Тип бронирования не выбран')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Get Telegram user data
      const webApp = window.Telegram?.WebApp
      const telegram_id = webApp?.initDataUnsafe?.user?.id
      const initData = webApp?.initData

      if (!telegram_id) {
        throw new Error('Telegram user ID not found')
      }

      if (!initData) {
        throw new Error('Telegram authentication data not found')
      }

      // Call Edge Function
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-booking`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'X-Telegram-Init-Data': initData,
          },
          body: JSON.stringify({
            trip_id,
            cabin_id: cabin.id,
            telegram_id,
            telegram_handle: formData.guest_telegram_handle,
            full_name: formData.guest_full_name,
            booking_type: formData.booking_type,
            guests_info,
            payer_details: formData.payer_details || undefined,
          }),
        }
      )

      const data = await response.json()

      if (!response.ok || !data.success) {
        // Handle specific error codes
        if (data.error_code === 'RACE_CONDITION') {
          setError(
            'Эта каюта только что была забронирована другим человеком. Пожалуйста, выберите другую каюту.'
          )
        } else if (data.error_code === 'CABIN_NOT_AVAILABLE') {
          setError(
            `Каюта недоступна для бронирования. Текущий статус: ${data.current_status}`
          )
        } else if (data.error_code === 'CABIN_NOT_HALF_AVAILABLE') {
          setError(
            'Невозможно присоединиться: каюта не имеет половинного бронирования.'
          )
        } else {
          setError(data.error || 'Ошибка при создании бронирования')
        }
        return
      }

      // Success!
      onSuccess(data.booking_id, data.total_amount)

      // Show Telegram notification if available
      if (webApp?.showPopup) {
        webApp.showPopup({
          title: 'Бронирование создано!',
          message: `Каюта #${cabin.cabin_number} забронирована. Сумма к оплате: €${totalAmount.toFixed(0)}`,
        })
      }
    } catch (err) {
      console.error('Booking error:', err)
      setError('Ошибка соединения с сервером. Попробуйте еще раз.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Подтверждение бронирования</h4>
        <p className={styles.hint}>Проверьте данные перед подтверждением</p>
      </div>

      {error && (
        <div className={styles.errorAlert}>
          <span className={styles.errorIcon}>⚠️</span>
          <div>
            <strong>Ошибка</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      <div className={styles.summary}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Каюта</span>
          <span className={styles.summaryValue}>
            #{cabin.cabin_number} ({cabin.deck})
          </span>
        </div>

        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Тип каюты</span>
          <span className={styles.summaryValue}>{cabin.bed_type}</span>
        </div>

        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Тип бронирования</span>
          <span className={styles.summaryValue}>
            {getBookingTypeDisplayName(formData.booking_type!)}
          </span>
        </div>

        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Гости</span>
          <span className={styles.summaryValue}>{guests_info}</span>
        </div>

        {formData.payer_details && (
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Информация об оплате</span>
            <span className={styles.summaryValue}>{formData.payer_details}</span>
          </div>
        )}

        <div className={`${styles.summaryItem} ${styles.totalRow}`}>
          <span className={styles.totalLabel}>Итого к оплате</span>
          <span className={styles.totalValue}>{formatPrice(totalAmount)}</span>
        </div>
      </div>

      <div className={styles.notice}>
        <p>
          После подтверждения бронирования с вами свяжется организатор для
          уточнения деталей и оплаты.
        </p>
      </div>

      <div className={styles.actions}>
        <button
          className={styles.buttonSecondary}
          onClick={onBack}
          disabled={loading}
        >
          Назад
        </button>
        <button
          className={styles.buttonPrimary}
          onClick={handleConfirm}
          disabled={loading}
        >
          {loading ? 'Бронируем...' : 'Подтвердить бронирование'}
        </button>
      </div>
    </div>
  )
}
