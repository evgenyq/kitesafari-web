import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Layout } from '../../components/Layout/Layout'
import { DeckPlan } from '../../components/DeckPlan/DeckPlan'
import { PhotoGallery } from '../../components/PhotoGallery/PhotoGallery'
import { CabinRow } from '../../components/CabinRow/CabinRow'
import { BookingModal } from '../../components/BookingModal'
import { useTrip } from '../../hooks/useTrip'
import { useCabins } from '../../hooks/useCabins'
import { getFirstImage } from '../../lib/utils'
import type { Cabin } from '../../types'
import styles from './CabinsPage.module.css'

export function CabinsPage() {
  const { accessCode } = useParams<{ accessCode: string }>()
  const { data: trip, loading: tripLoading } = useTrip(accessCode)
  const { data: cabinsByYacht, loading: cabinsLoading, error: cabinsError } = useCabins(trip?.id)

  const [selectedCabin, setSelectedCabin] = useState<Cabin | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const handleBookClick = (cabin: Cabin) => {
    setSelectedCabin(cabin)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setSelectedCabin(null)
  }

  if (tripLoading || cabinsLoading) {
    return (
      <Layout>
        <div className={styles.loading}>Загрузка кают...</div>
      </Layout>
    )
  }

  if (!trip || cabinsError) {
    return (
      <Layout>
        <div className={styles.error}>
          <h1>Ошибка загрузки</h1>
          <Link to={`/${accessCode}`}>← Вернуться к трипу</Link>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className={styles.header}>
        <Link to={`/${accessCode}`} className={styles.backLink}>
          ← Назад к трипу
        </Link>
        <h1>{trip.name} - Каюты</h1>
      </div>

      {cabinsByYacht && cabinsByYacht.length > 0 ? (
        cabinsByYacht.map(({ yacht, cabinsByDeck }) => {
          const deckPlanUrl = getFirstImage(yacht.deck_plan_urls)

          return (
            <section key={yacht.id} className={styles.yachtSection}>
              <h2 className={styles.yachtName}>🛥️ {yacht.name}</h2>

              {deckPlanUrl && <DeckPlan url={deckPlanUrl} yachtName={yacht.name} />}

              {yacht.description && (
                <p className={styles.description}>{yacht.description}</p>
              )}

              <PhotoGallery photos={yacht.photos_urls} alt={yacht.name} />

              <div className={styles.cabinsContainer}>
                {Object.entries(cabinsByDeck)
                  .sort(([deckA], [deckB]) => {
                    const order = { 'Lower Deck': 1, 'Main Deck': 2, 'Upper Deck': 3, 'Sun Deck': 4 }
                    return (order[deckA as keyof typeof order] || 999) - (order[deckB as keyof typeof order] || 999)
                  })
                  .map(([deck, cabins]) => (
                    <div key={deck} className={styles.deckGroup}>
                      <h3 className={styles.deckName}>{deck}</h3>
                      <div className={styles.cabinsList}>
                        {cabins.map((cabin) => (
                          <CabinRow key={cabin.id} cabin={cabin} onBookClick={handleBookClick} />
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          )
        })
      ) : (
        <p className={styles.empty}>Каюты не найдены</p>
      )}

      {selectedCabin && trip && (
        <BookingModal
          cabin={selectedCabin}
          trip_id={trip.id}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
        />
      )}
    </Layout>
  )
}
