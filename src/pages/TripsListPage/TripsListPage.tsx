import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../../components/Layout/Layout'
import { supabase } from '../../lib/supabase'
import type { Trip } from '../../types'
import styles from './TripsListPage.module.css'

interface TripsListPageProps {
  allowedTripCodes: string[]
}

export function TripsListPage({ allowedTripCodes }: TripsListPageProps) {
  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchTrips() {
      try {
        const { data, error } = await supabase
          .from('trips')
          .select('*')
          .in('access_code', allowedTripCodes)
          .order('start_date', { ascending: false })

        if (error) throw error
        setTrips(data || [])
      } catch (error) {
        console.error('Error fetching trips:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchTrips()
  }, [allowedTripCodes])

  if (loading) {
    return (
      <Layout>
        <div className={styles.loading}>Загрузка трипов...</div>
      </Layout>
    )
  }

  if (trips.length === 0) {
    return (
      <Layout>
        <div className={styles.empty}>
          <p>Трипы не найдены</p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className={styles.container}>
        <h1 className={styles.title}>Мои трипы</h1>
        <div className={styles.tripsList}>
          {trips.map((trip) => (
            <Link
              key={trip.id}
              to={`/${trip.access_code}`}
              className={styles.tripCard}
            >
              <h2 className={styles.tripName}>{trip.name}</h2>
              <p className={styles.tripDates}>
                {new Date(trip.start_date).toLocaleDateString('ru-RU')} -{' '}
                {new Date(trip.end_date).toLocaleDateString('ru-RU')}
              </p>
              {trip.description && (
                <p className={styles.tripDescription}>{trip.description}</p>
              )}
            </Link>
          ))}
        </div>
      </div>
    </Layout>
  )
}
