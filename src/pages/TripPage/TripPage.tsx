import { useParams, Link } from 'react-router-dom'
import { Layout } from '../../components/Layout/Layout'
import { YachtCard } from '../../components/YachtCard/YachtCard'
import { useTrip } from '../../hooks/useTrip'
import { useYachts } from '../../hooks/useYachts'
import { formatDateRange, getFirstImage, getPlaceholderImage } from '../../lib/utils'
import styles from './TripPage.module.css'

export function TripPage() {
  const { accessCode } = useParams<{ accessCode: string }>()
  const { data: trip, loading: tripLoading, error: tripError } = useTrip(accessCode)
  const { data: yachts, loading: yachtsLoading, error: yachtsError } = useYachts(trip?.id)

  if (tripLoading) {
    return (
      <Layout>
        <div className={styles.loading}>Загрузка трипа...</div>
      </Layout>
    )
  }

  if (tripError || !trip) {
    return (
      <Layout>
        <div className={styles.error}>
          <h1>❌ Трип не найден</h1>
          <p>Неверный код доступа</p>
        </div>
      </Layout>
    )
  }

  const tripImage = getFirstImage(trip.photos_urls) || getPlaceholderImage()
  const totalCabins = yachts?.reduce((sum, y) => sum + y.total_cabins, 0) || 0
  const bookedCabins = yachts?.reduce((sum, y) => sum + (y.total_cabins - y.available_cabins), 0) || 0

  return (
    <Layout>
      <div className={styles.hero}>
        <img src={tripImage} alt={trip.name} className={styles.heroImage} />
        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>{trip.name}</h1>
          <p className={styles.heroDates}>
            {formatDateRange(trip.start_date, trip.end_date)}
          </p>
        </div>
      </div>

      {trip.description && (
        <section className={styles.section}>
          <h2>Описание</h2>
          <p className={styles.description}>{trip.description}</p>
        </section>
      )}

      {trip.terms && (
        <section className={styles.section}>
          <h2>Условия</h2>
          <p className={styles.terms}>{trip.terms}</p>
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.stats}>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{bookedCabins}/{totalCabins}</span>
            <span className={styles.statLabel}>кают забронировано</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{yachts?.length || 0}</span>
            <span className={styles.statLabel}>яхт</span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Яхты</h2>
        {yachtsLoading && <div className={styles.loading}>Загрузка яхт...</div>}
        {yachtsError && <div className={styles.error}>Ошибка загрузки яхт</div>}
        {yachts && yachts.length > 0 ? (
          <div className={styles.yachtsList}>
            {yachts.map((yacht) => (
              <YachtCard key={yacht.id} yacht={yacht} />
            ))}
          </div>
        ) : (
          <p>Яхты не найдены</p>
        )}
      </section>

      <div className={styles.cta}>
        <Link to={`/${accessCode}/cabins`} className={styles.ctaButton}>
          Посмотреть все каюты
        </Link>
      </div>
    </Layout>
  )
}
