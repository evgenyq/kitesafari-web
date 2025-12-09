import { useTelegramWebApp } from '../../hooks/useTelegramWebApp'
import { getPlaceholderImage } from '../../lib/utils'
import type { Yacht } from '../../types'
import styles from './DeckPlan.module.css'

interface DeckPlanProps {
  url: string | null
  yachtName: string
  yacht?: Yacht
  onOpenInteractive?: () => void
}

export function DeckPlan({ url, yachtName, yacht, onOpenInteractive }: DeckPlanProps) {
  const { webApp, isInTelegram } = useTelegramWebApp()

  if (!url) {
    return null
  }

  const hasCabinMap = yacht?.cabin_map !== null && yacht?.cabin_map !== undefined

  const handleImageClick = () => {
    // Priority 1: Interactive deck plan if cabin_map exists
    if (hasCabinMap && onOpenInteractive) {
      onOpenInteractive()
    }
    // Priority 2: Fallback - open image in Telegram viewer
    else if (isInTelegram && webApp && url) {
      webApp.openLink(url, { try_instant_view: true })
    }
  }

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>
        Поэтажный план
        {hasCabinMap && <span className={styles.badge}>Интерактивный</span>}
      </h3>
      <img
        src={url || getPlaceholderImage()}
        alt={`Deck plan - ${yachtName}`}
        className={styles.image}
        onClick={handleImageClick}
        style={{ cursor: hasCabinMap || isInTelegram ? 'pointer' : 'default' }}
      />
      {hasCabinMap && (
        <p className={styles.hint}>👆 Нажми для интерактивного просмотра</p>
      )}
    </div>
  )
}
