import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../../components/Layout/Layout'
import { supabase } from '../../lib/supabase'
import type { Trip } from '../../types'
import styles from './TripsListPage.module.css'

interface TripsListPageProps {
  allowedTripCodes: string[]
  isAdmin?: boolean
}

export function TripsListPage({ allowedTripCodes, isAdmin = false }: TripsListPageProps) {
  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchTrips() {
      try {
        let query = supabase
          .from('trips')
          .select('*')
          .order('start_date', { ascending: false })

        // For non-admin users, filter by allowed trip codes
        if (!isAdmin && allowedTripCodes.length > 0) {
          query = query.in('access_code', allowedTripCodes)
        }

        const { data, error } = await query

        if (error) throw error
        setTrips(data || [])
      } catch (error) {
        console.error('Error fetching trips:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchTrips()
  }, [allowedTripCodes, isAdmin])

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
