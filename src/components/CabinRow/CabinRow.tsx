import { Cabin } from '../../types'
import { StatusBadge } from '../StatusBadge/StatusBadge'
import { formatPrice } from '../../lib/utils'
import styles from './CabinRow.module.css'

interface CabinRowProps {
  cabin: Cabin
}

export function CabinRow({ cabin }: CabinRowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.number}>#{cabin.cabin_number}</div>
      <div className={styles.bedType}>{cabin.bed_type}</div>
      <div className={styles.price}>{formatPrice(cabin.price)}</div>
      <div className={styles.status}>
        <StatusBadge status={cabin.status} guests={cabin.guests} />
      </div>
    </div>
  )
}
