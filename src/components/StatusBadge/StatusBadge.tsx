import { CabinStatus } from '../../types'
import { getStatusColor, getStatusText } from '../../lib/utils'
import styles from './StatusBadge.module.css'

interface StatusBadgeProps {
  status: CabinStatus
  guests?: string | null
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const color = getStatusColor(status)
  const text = getStatusText(status)

  return (
    <div className={styles.badge}>
      <span className={styles.dot} style={{ backgroundColor: color }} />
      <span className={styles.status}>{text}</span>
    </div>
  )
}
