import { useEffect, useState } from 'react'
import { useParams, Link, Navigate } from 'react-router-dom'
import { Layout } from '../../components/Layout/Layout'
import { AdminBookingModal } from './AdminBookingModal'
import { useTrip } from '../../hooks/useTrip'
import { useAllCabins } from '../../hooks/useAllCabins'
import { useAdmin } from '../../hooks/useAdmin'
import { fetchSheetUrl } from '../../lib/cabinGuests'
import type { Cabin } from '../../types'
import styles from './AdminPage.module.css'

export function AdminPage() {
  const { accessCode } = useParams<{ accessCode: string }>()
  const { isAdmin, loading: adminLoading } = useAdmin()
  const { data: trip, loading: tripLoading } = useTrip(accessCode)
  const { data: cabinsByYacht, loading: cabinsLoading } = useAllCabins(trip?.id)

  const [selectedCabin, setSelectedCabin] = useState<Cabin | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [sheetUrl, setSheetUrl] = useState<string | null>(null)

  useEffect(() => {
    if (trip?.id) fetchSheetUrl(trip.id).then(setSheetUrl)
  }, [trip?.id])

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

        {sheetUrl && (
          <a className={styles.exportButton} href={sheetUrl} target="_blank" rel="noreferrer">
            📊 Открыть Google-таблицу
          </a>
        )}
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
                        <div className={styles.col}>
                          <strong>Каюта</strong>
                          <span>#{cabin.cabin_number}</span>
                        </div>
                        <div className={styles.col}>
                          <strong>Тип</strong>
                          <span>{cabin.bed_type}</span>
                        </div>
                        <div className={styles.col}>
                          <strong>Статус</strong>
                          <span className={`${styles.status} ${styles[cabin.status.replace(' ', '')]}`}>
                            {cabin.status}
                          </span>
                        </div>
                        <div className={styles.col}>
                          <strong>Гости</strong>
                          <span>{cabin.guests || <span className={styles.empty}>—</span>}</span>
                        </div>
                        <div className={styles.col}>
                          <strong>Цена</strong>
                          <span>${cabin.price}</span>
                        </div>
                        <div className={styles.col}>
                          <button
                            className={styles.actionButton}
                            onClick={() => handleBookCabin(cabin)}
                          >
                            Изменить
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
