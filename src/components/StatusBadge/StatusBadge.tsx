import { CabinStatus } from '../../types'
import { getStatusColor, getStatusText } from '../../lib/utils'
import styles from './StatusBadge.module.css'

interface StatusBadgeProps {
  status: CabinStatus
  guests?: string | null
}

export function StatusBadge({ status, guests }: StatusBadgeProps) {
  const color = getStatusColor(status)
  const text = getStatusText(status)
  const shouldShowGuests = guests && (status === 'Booked' || status === 'Half Available')

  return (
    <div className={styles.badge}>
      <span className={styles.dot} style={{ backgroundColor: color }} />
      <span className={styles.status}>{text}</span>
      {shouldShowGuests && <span className={styles.guests}>: {guests}</span>}
    </div>
  )
}
