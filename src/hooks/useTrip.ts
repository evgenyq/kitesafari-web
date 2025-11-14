import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Trip, UseDataResult } from '../types'

export function useTrip(accessCode: string | undefined): UseDataResult<Trip> {
  const [data, setData] = useState<Trip | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!accessCode) {
      setLoading(false)
      return
    }

    const fetchTrip = async () => {
      try {
        setLoading(true)
        setError(null)

        const { data: trip, error: fetchError } = await supabase
          .from('trips')
          .select('*')
          .eq('access_code', accessCode)
          .single()

        if (fetchError) throw fetchError

        setData(trip)
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch trip'))
        setData(null)
      } finally {
        setLoading(false)
      }
    }

    fetchTrip()
  }, [accessCode])

  return { data, loading, error }
}
