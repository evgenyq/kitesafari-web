import { Cabin } from '../../types'
import { StatusBadge } from '../StatusBadge/StatusBadge'
import { BedTypeIcon } from '../BedTypeIcon'
import { formatPrice } from '../../lib/utils'
import styles from './CabinRow.module.css'

interface CabinRowProps {
  cabin: Cabin
  onBookClick?: (cabin: Cabin) => void
}

export function CabinRow({ cabin, onBookClick }: CabinRowProps) {
  // Only show guests for Half Available cabins (so users know who's already there)
  const showGuests = cabin.guests && cabin.status === 'Half Available'

  // Cabin is bookable if Available or Half Available
  const isBookable = cabin.status === 'Available' || cabin.status === 'Half Available'

  return (
    <div className={styles.row}>
      <div className={styles.number}>#{cabin.cabin_number}</div>
      <div className={styles.bedType}>
        <BedTypeIcon bedType={cabin.bed_type} size={18} />
        <span className={styles.bedTypeText}>{cabin.bed_type}</span>
      </div>
      <div className={styles.price}>{formatPrice(cabin.price)}</div>
      <div className={styles.status}>
        <StatusBadge status={cabin.status} />
      </div>
      {showGuests && <div className={styles.guests}>{cabin.guests}</div>}
      {isBookable && onBookClick && (
        <button
          className={styles.bookButton}
          onClick={() => onBookClick(cabin)}
          aria-label={`Забронировать каюту ${cabin.cabin_number}`}
        >
          Забронировать
        </button>
      )}
    </div>
  )
}
