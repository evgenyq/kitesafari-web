import { useState } from 'react'
import type { Cabin, CabinStatus } from '../../types'
import styles from './AdminBookingModal.module.css'

interface AdminBookingModalProps {
  cabin: Cabin
  trip_id: string
  isOpen: boolean
  onClose: () => void
}

const CABIN_STATUSES: CabinStatus[] = ['Available', 'Half Available', 'Booked', 'Paid', 'Unavailable', 'STAFF']

export function AdminBookingModal({
  cabin,
  trip_id,
  isOpen,
  onClose,
}: AdminBookingModalProps) {
  const [guestsInfo, setGuestsInfo] = useState(cabin.guests || '')
  const [status, setStatus] = useState<CabinStatus>(cabin.status)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [showWarning, setShowWarning] = useState(false)

  if (!isOpen) return null

  // Check if status allows empty guests
  const canBeEmpty = status === 'Available' || status === 'STAFF'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // If status allows empty guests but guests field is not empty, show warning
    if (canBeEmpty && guestsInfo.trim() && !showWarning) {
      setShowWarning(true)
      return
    }

    // If status requires guests and field is empty
    if (!canBeEmpty && !guestsInfo.trim()) {
      setError('Укажите гостей для данного статуса')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const webApp = window.Telegram?.WebApp
      const initData = webApp?.initData

      if (!initData) {
        throw new Error('Telegram initData not found')
      }

      // For Available/STAFF statuses, clear guests info
      const finalGuestsInfo = canBeEmpty ? '' : guestsInfo.trim()

      const requestBody = {
        trip_id,
        cabin_id: cabin.id,
        guests_info: finalGuestsInfo,
        cabin_status: status,
        admin_override: true,
      }

      console.log('📤 Sending request:', requestBody)

      // Call create-booking with admin_override
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-booking`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'X-Telegram-Init-Data': initData,
          },
          body: JSON.stringify(requestBody),
        }
      )

      console.log('📥 Response status:', response.status)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ Response error:', errorText)
        throw new Error(`Server error: ${response.status} - ${errorText}`)
      }

      const data = await response.json()
      console.log('📋 Response data:', data)

      if (!data.success) {
        throw new Error(data.error || 'Failed to update cabin')
      }

      setSuccess(true)
      setTimeout(() => {
        onClose()
        window.location.reload() // Refresh to show updated data
      }, 1500)
    } catch (err) {
      console.error('❌ Full error:', err)
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setError('Ошибка сети: не удалось подключиться к серверу')
      } else {
        setError(err instanceof Error ? err.message : 'Не удалось обновить каюту')
      }
      setLoading(false)
    }
  }

  const handleClear = () => {
    setGuestsInfo('')
  }

  const handleStatusChange = (newStatus: CabinStatus) => {
    setStatus(newStatus)
    setShowWarning(false) // Reset warning when status changes
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>
            {cabin.status === 'Available' ? 'Забронировать' : 'Перебронировать'} каюту #
            {cabin.cabin_number}
          </h2>
          <button className={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={styles.cabinInfo}>
          <p>
            <strong>Палуба:</strong> {cabin.deck}
          </p>
          <p>
            <strong>Тип:</strong> {cabin.bed_type}
          </p>
          <p>
            <strong>Цена:</strong> ${cabin.price}
          </p>
          <p>
            <strong>Статус:</strong>{' '}
            <span className={`${styles.status} ${styles[cabin.status.replace(' ', '')]}`}>
              {cabin.status}
            </span>
          </p>
        </div>

        {success ? (
          <div className={styles.success}>
            <p>✅ Каюта успешно обновлена!</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="status">
                Статус каюты <span className={styles.required}>*</span>
              </label>
              <select
                id="status"
                className={styles.select}
                value={status}
                onChange={(e) => handleStatusChange(e.target.value as CabinStatus)}
                disabled={loading}
                required
              >
                {CABIN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label htmlFor="guests">
                Гости {!canBeEmpty && <span className={styles.required}>*</span>}
              </label>
              <textarea
                id="guests"
                className={styles.textarea}
                value={guestsInfo}
                onChange={(e) => setGuestsInfo(e.target.value)}
                placeholder="Введите имена гостей через запятую или с новой строки&#10;Пример:&#10;Иван Петров&#10;Мария Сидорова"
                rows={5}
                disabled={loading}
                required={!canBeEmpty}
              />
              <p className={styles.hint}>
                {canBeEmpty
                  ? 'Для статусов Available и STAFF информация о гостях будет автоматически очищена'
                  : 'Можно указать любые имена в свободной форме'}
              </p>
            </div>

            {showWarning && (
              <div className={styles.warning}>
                ⚠️ При сохранении статуса "{status}" информация о гостях будет удалена. Продолжить?
              </div>
            )}

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.clearButton}
                onClick={handleClear}
                disabled={loading}
              >
                Очистить
              </button>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={onClose}
                disabled={loading}
              >
                Отмена
              </button>
              <button
                type="submit"
                className={styles.submitButton}
                disabled={loading || (!canBeEmpty && !guestsInfo.trim())}
              >
                {loading ? 'Сохранение...' : showWarning ? 'Подтвердить' : 'Сохранить'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
