import { useState } from 'react'
import { useParams, Link, Navigate } from 'react-router-dom'
import { Layout } from '../../components/Layout/Layout'
import { AdminBookingModal } from './AdminBookingModal'
import { useTrip } from '../../hooks/useTrip'
import { useCabins } from '../../hooks/useCabins'
import { useAdmin } from '../../hooks/useAdmin'
import type { Cabin } from '../../types'
import styles from './AdminPage.module.css'

export function AdminPage() {
  const { accessCode } = useParams<{ accessCode: string }>()
  const { isAdmin, loading: adminLoading } = useAdmin()
  const { data: trip, loading: tripLoading } = useTrip(accessCode)
  const { data: cabinsByYacht, loading: cabinsLoading } = useCabins(trip?.id)

  const [selectedCabin, setSelectedCabin] = useState<Cabin | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const handleBookCabin = (cabin: Cabin) => {
    setSelectedCabin(cabin)
    setModalOpen(true)
  }

  const handleCloseModal = () => {
    setSelectedCabin(null)
    setModalOpen(false)
  }

  // Check admin access
  if (adminLoading) {
    return (
      <Layout>
        <div className={styles.loading}>Проверка прав доступа...</div>
      </Layout>
    )
  }

  if (!isAdmin) {
    return <Navigate to={`/${accessCode}`} replace />
  }

  if (tripLoading || cabinsLoading) {
    return (
      <Layout>
        <div className={styles.loading}>Загрузка...</div>
      </Layout>
    )
  }

  if (!trip) {
    return (
      <Layout>
        <div className={styles.error}>
          <h1>Трип не найден</h1>
          <Link to="/">← На главную</Link>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className={styles.header}>
        <Link to={`/${accessCode}/cabins`} className={styles.backLink}>
          ← К каютам
        </Link>
        <h1>🛠️ Админ-панель: {trip.name}</h1>
        <p className={styles.subtitle}>Управление бронированиями</p>
      </div>

      {cabinsByYacht && cabinsByYacht.length > 0 ? (
        cabinsByYacht.map(({ yacht, cabinsByDeck }) => (
          <section key={yacht.id} className={styles.yachtSection}>
            <h2 className={styles.yachtName}>🛥️ {yacht.name}</h2>

            {Object.entries(cabinsByDeck)
              .sort(([deckA], [deckB]) => {
                const order = { 'Lower Deck': 1, 'Main Deck': 2, 'Upper Deck': 3, 'Sun Deck': 4 }
                return (order[deckA as keyof typeof order] || 999) - (order[deckB as keyof typeof order] || 999)
              })
              .map(([deck, cabins]) => (
                <div key={deck} className={styles.deckGroup}>
                  <h3 className={styles.deckName}>{deck}</h3>

                  <div className={styles.cabinsTable}>
                    <div className={styles.tableHeader}>
                      <div className={styles.col}>Каюта</div>
                      <div className={styles.col}>Тип</div>
                      <div className={styles.col}>Статус</div>
                      <div className={styles.col}>Гости</div>
                      <div className={styles.col}>Цена</div>
                      <div className={styles.col}>Действия</div>
                    </div>

                    {cabins.map((cabin) => (
                      <div key={cabin.id} className={styles.tableRow}>
                        <div className={styles.col}>#{cabin.cabin_number}</div>
                        <div className={styles.col}>{cabin.bed_type}</div>
                        <div className={styles.col}>
                          <span className={`${styles.status} ${styles[cabin.status.replace(' ', '')]}`}>
                            {cabin.status}
                          </span>
                        </div>
                        <div className={styles.col}>
                          {cabin.guests || <span className={styles.empty}>—</span>}
                        </div>
                        <div className={styles.col}>${cabin.price}</div>
                        <div className={styles.col}>
                          <button
                            className={styles.actionButton}
                            onClick={() => handleBookCabin(cabin)}
                          >
                            {cabin.status === 'Available' ? 'Забронировать' : 'Перебронировать'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </section>
        ))
      ) : (
        <p className={styles.empty}>Каюты не найдены</p>
      )}

      {/* Admin Booking Modal */}
      {selectedCabin && trip && (
        <AdminBookingModal
          cabin={selectedCabin}
          trip_id={trip.id}
          isOpen={modalOpen}
          onClose={handleCloseModal}
        />
      )}
    </Layout>
  )
}
