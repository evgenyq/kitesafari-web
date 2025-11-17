import { Cabin } from '../../types'
import { formatPrice } from '../../lib/utils'
import { getBookingTypeDisplayName } from '../../lib/guestUtils'
import type { BookingType } from './types'
import styles from './BookingSuccess.module.css'

interface BookingSuccessProps {
  bookingId: string
  cabin: Cabin
  bookingType: BookingType
  totalAmount: number
  onClose: () => void
}

export function BookingSuccess({
  bookingId,
  cabin,
  bookingType,
  totalAmount,
  onClose,
}: BookingSuccessProps) {
  return (
    <div className={styles.container}>
      <div className={styles.iconContainer}>
        <div className={styles.successIcon}>✓</div>
      </div>

      <div className={styles.content}>
        <h3 className={styles.title}>Бронирование успешно создано!</h3>

        <p className={styles.message}>
          Каюта #{cabin.cabin_number} ({cabin.bed_type}) забронирована.
          Организатор свяжется с вами для уточнения деталей.
        </p>

        <div className={styles.details}>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Номер бронирования</span>
            <span className={styles.detailValue}>
              {bookingId.slice(0, 8).toUpperCase()}
            </span>
          </div>

          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Тип бронирования</span>
            <span className={styles.detailValue}>
              {getBookingTypeDisplayName(bookingType)}
            </span>
          </div>

          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Сумма к оплате</span>
            <span className={`${styles.detailValue} ${styles.amount}`}>
              {formatPrice(totalAmount)}
            </span>
          </div>
        </div>

        <div className={styles.notice}>
          <h4 className={styles.noticeTitle}>Что дальше?</h4>
          <ul className={styles.noticeList}>
            <li>Организатор получил уведомление о вашем бронировании</li>
            <li>В течение 24 часов с вами свяжутся в Telegram</li>
            <li>Вам отправят реквизиты для оплаты</li>
            <li>Срок оплаты: 14 дней с момента бронирования</li>
          </ul>
        </div>
      </div>

      <div className={styles.actions}>
        <button className={styles.buttonPrimary} onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  )
}
