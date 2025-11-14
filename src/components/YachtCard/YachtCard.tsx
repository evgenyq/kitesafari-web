import { YachtWithStats } from '../../types'
import { getFirstImage, getPlaceholderImage } from '../../lib/utils'
import styles from './YachtCard.module.css'

interface YachtCardProps {
  yacht: YachtWithStats
}

export function YachtCard({ yacht }: YachtCardProps) {
  const imageUrl = getFirstImage(yacht.photos_urls) || getPlaceholderImage()
  const hasAvailable = yacht.available_cabins > 0

  return (
    <div className={styles.card}>
      <img src={imageUrl} alt={yacht.name} className={styles.image} />
      <div className={styles.content}>
        <h2 className={styles.name}>{yacht.name}</h2>
        {yacht.description && (
          <p className={styles.description}>{yacht.description}</p>
        )}
        <div className={`${styles.stats} ${hasAvailable ? styles.available : styles.full}`}>
          {hasAvailable ? '🟢' : '🔴'} {yacht.available_cabins} доступно из {yacht.total_cabins}
        </div>
      </div>
    </div>
  )
}
