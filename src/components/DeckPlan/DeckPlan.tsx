import { useTelegramWebApp } from '../../hooks/useTelegramWebApp'
import { getPlaceholderImage } from '../../lib/utils'
import styles from './DeckPlan.module.css'

interface DeckPlanProps {
  url: string | null
  yachtName: string
}

export function DeckPlan({ url, yachtName }: DeckPlanProps) {
  const { webApp, isInTelegram } = useTelegramWebApp()

  if (!url) {
    return null
  }

  const handleImageClick = () => {
    if (isInTelegram && webApp && url) {
      // Open image in Telegram's native image viewer
      webApp.openLink(url, { try_instant_view: true })
    }
  }

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Поэтажный план</h3>
      <img
        src={url || getPlaceholderImage()}
        alt={`Deck plan - ${yachtName}`}
        className={styles.image}
        onClick={handleImageClick}
        style={{ cursor: isInTelegram ? 'pointer' : 'default' }}
      />
    </div>
  )
}
