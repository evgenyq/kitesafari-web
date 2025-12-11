import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Layout } from '../../components/Layout/Layout'
import { DeckPlan } from '../../components/DeckPlan/DeckPlan'
import { PhotoGallery } from '../../components/PhotoGallery/PhotoGallery'
import { CabinRow } from '../../components/CabinRow/CabinRow'
import { BookingModal } from '../../components/BookingModal'
import { InteractiveDeckPlan } from '../../components/InteractiveDeckPlan'
import { useTrip } from '../../hooks/useTrip'
import { useCabins } from '../../hooks/useCabins'
import { useAdmin } from '../../hooks/useAdmin'
import { getFirstImage } from '../../lib/utils'
import type { Cabin, Yacht } from '../../types'
import styles from './CabinsPage.module.css'

export function CabinsPage() {
  const { accessCode } = useParams<{ accessCode: string }>()
  const { data: trip, loading: tripLoading } = useTrip(accessCode)
  const { data: cabinsByYacht, loading: cabinsLoading, error: cabinsError } = useCabins(trip?.id)
  const { isAdmin } = useAdmin()

  // Interactive deck plan state
  const [interactivePlan, setInteractivePlan] = useState<{
    isOpen: boolean
    yacht: Yacht | null
    cabins: Cabin[]
  }>({ isOpen: false, yacht: null, cabins: [] })

  // Booking modal state
  const [bookingContext, setBookingContext] = useState<{
    cabin: Cabin | null
    isOpen: boolean
    returnToMap: boolean
  }>({ cabin: null, isOpen: false, returnToMap: false })

  const handleBookClick = (cabin: Cabin) => {
    setBookingContext({ cabin, isOpen: true, returnToMap: false })
  }

  const handleOpenInteractivePlan = (yacht: Yacht, cabins: Cabin[]) => {
    setInteractivePlan({ isOpen: true, yacht, cabins })
  }

  const handleCloseInteractivePlan = () => {
    setInteractivePlan({ isOpen: false, yacht: null, cabins: [] })
  }

  const handleBookFromMap = (cabin: Cabin) => {
    // Keep yacht/cabins data, just close the UI
    setBookingContext({ cabin, isOpen: true, returnToMap: true })
    setInteractivePlan(prev => ({ ...prev, isOpen: false }))
  }

  const handleCloseBooking = () => {
    const shouldReturnToMap = bookingContext.returnToMap

    // Always close booking
    setBookingContext({ cabin: null, isOpen: false, returnToMap: false })

    if (shouldReturnToMap && interactivePlan.yacht) {
      // Return to interactive map
      setInteractivePlan(prev => ({ ...prev, isOpen: true }))
    } else {
      // Normal close - clear everything
      setInteractivePlan({ isOpen: false, yacht: null, cabins: [] })
    }
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
        {isAdmin && (
          <Link to={`/${accessCode}/admin`} className={styles.adminLink}>
            🛠️ Админ-панель
          </Link>
        )}
      </div>

      {cabinsByYacht && cabinsByYacht.length > 0 ? (
        cabinsByYacht.map(({ yacht, cabinsByDeck }) => {
          const deckPlanUrl = getFirstImage(yacht.deck_plan_urls)
          const allCabinsForYacht = Object.values(cabinsByDeck).flat()

          return (
            <section key={yacht.id} className={styles.yachtSection}>
              <h2 className={styles.yachtName}>🛥️ {yacht.name}</h2>

              {deckPlanUrl && (
                <DeckPlan
                  url={deckPlanUrl}
                  yachtName={yacht.name}
                  yacht={yacht}
                  onOpenInteractive={() => handleOpenInteractivePlan(yacht, allCabinsForYacht)}
                />
              )}

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

      {/* Interactive Deck Plan overlay */}
      {interactivePlan.isOpen && interactivePlan.yacht && (
        <InteractiveDeckPlan
          yacht={interactivePlan.yacht}
          cabins={interactivePlan.cabins}
          isOpen={interactivePlan.isOpen}
          onClose={handleCloseInteractivePlan}
          onBookCabin={handleBookFromMap}
        />
      )}

      {/* Booking Modal - hidden when returning to map */}
      {bookingContext.cabin && trip && (
        <div style={{ display: bookingContext.returnToMap && interactivePlan.isOpen ? 'none' : 'block' }}>
          <BookingModal
            cabin={bookingContext.cabin}
            trip_id={trip.id}
            isOpen={bookingContext.isOpen}
            onClose={handleCloseBooking}
          />
        </div>
      )}
    </Layout>
  )
}
