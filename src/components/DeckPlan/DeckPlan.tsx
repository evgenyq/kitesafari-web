import { getPlaceholderImage } from '../../lib/utils'
import styles from './DeckPlan.module.css'

interface DeckPlanProps {
  url: string | null
  yachtName: string
}

export function DeckPlan({ url, yachtName }: DeckPlanProps) {
  if (!url) {
    return null
  }

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Поэтажный план</h3>
      <img
        src={url || getPlaceholderImage()}
        alt={`Deck plan - ${yachtName}`}
        className={styles.image}
      />
    </div>
  )
}
