import { getPlaceholderImage } from '../../lib/utils'
import styles from './PhotoGallery.module.css'

interface PhotoGalleryProps {
  photos: string[] | null
  alt: string
}

export function PhotoGallery({ photos, alt }: PhotoGalleryProps) {
  if (!photos || photos.length === 0) {
    return null
  }

  return (
    <div className={styles.gallery}>
      {photos.map((photo, index) => (
        <div key={index} className={styles.item}>
          <img
            src={photo || getPlaceholderImage()}
            alt={`${alt} ${index + 1}`}
            className={styles.image}
          />
        </div>
      ))}
    </div>
  )
}
