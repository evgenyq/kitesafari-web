import type { CabinWithCoords } from '../../types'
import styles from './CabinMarker.module.css'

interface CabinMarkerProps {
  cabin: CabinWithCoords
  imageWidth: number
  imageHeight: number
  onClick: (cabin: CabinWithCoords) => void
}

export function CabinMarker({ cabin, imageWidth, imageHeight, onClick }: CabinMarkerProps) {
  const { coords, status, cabin_number } = cabin

  // Convert pixel coordinates to percentages
  const leftPercent = (coords.left / imageWidth) * 100
  const topPercent = (coords.top / imageHeight) * 100
  const widthPercent = ((coords.right - coords.left) / imageWidth) * 100
  const heightPercent = ((coords.bottom - coords.top) / imageHeight) * 100

  const getStatusClass = () => {
    switch (status) {
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

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Only clickable if available or half available
    if (status === 'Available' || status === 'Half Available') {
      onClick(cabin)
    }
  }

  return (
    <div
      className={`${styles.marker} ${getStatusClass()}`}
      style={{
        left: `${leftPercent}%`,
        top: `${topPercent}%`,
        width: `${widthPercent}%`,
        height: `${heightPercent}%`,
      }}
      onClick={handleClick}
    />
  )
}
