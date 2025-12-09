import { formatPrice, getStatusText } from '../../lib/utils'
import type { Cabin } from '../../types'
import styles from './CabinPopup.module.css'

interface CabinPopupProps {
  cabin: Cabin
  onClose: () => void
  onBook: (cabin: Cabin) => void
}

export function CabinPopup({ cabin, onClose, onBook }: CabinPopupProps) {
  const canBook = cabin.status === 'Available' || cabin.status === 'Half Available'

  const getStatusClass = () => {
    switch (cabin.status) {
      case 'Available':
        return styles.available
      case 'Booked':
        return styles.booked
      case 'Half Available':
        return styles.half
      default:
        return ''
    }
  }

  const handleBookClick = () => {
    onBook(cabin)
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.popup}>
        <div className={styles.header}>
          <h3 className={styles.title}>Каюта #{cabin.cabin_number}</h3>
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}>
              <span className={styles.icon}>📍</span>
              <span className={styles.label}>Палуба:</span>
              <span className={styles.value}>{cabin.deck}</span>
            </div>

            <div className={styles.infoItem}>
              <span className={styles.icon}>🛏️</span>
              <span className={styles.label}>Кровати:</span>
              <span className={styles.value}>{cabin.bed_type}</span>
            </div>

            <div className={styles.infoItem}>
              <span className={styles.icon}>💰</span>
              <span className={styles.label}>Цена:</span>
              <span className={styles.value}>{formatPrice(cabin.price)}</span>
            </div>

            <div className={styles.infoItem}>
              <span className={styles.icon}>📊</span>
              <span className={styles.label}>Статус:</span>
              <span className={`${styles.statusBadge} ${getStatusClass()}`}>
                {getStatusText(cabin.status)}
              </span>
            </div>
          </div>

          {cabin.guests && (
            <div className={styles.guests}>
              <strong>👥 Гости:</strong> {cabin.guests}
            </div>
          )}

          {canBook && (
            <button
              className={styles.bookButton}
              onClick={handleBookClick}
            >
              Забронировать
            </button>
          )}
        </div>
      </div>
    </>
  )
}
