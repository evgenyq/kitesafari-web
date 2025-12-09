import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { YachtWithStats, UseDataResult } from '../types'

export function useYachts(tripId: string | undefined): UseDataResult<YachtWithStats[]> {
  const [data, setData] = useState<YachtWithStats[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!tripId) {
      setLoading(false)
      return
    }

    const fetchYachts = async () => {
      try {
        setLoading(true)
        setError(null)

        // Fetch all cabins for the trip with yacht info
        const { data: cabins, error: fetchError } = await supabase
          .from('cabins')
          .select('*, yachts(*)')
          .eq('trip_id', tripId)

        if (fetchError) throw fetchError

        // Group by yacht and calculate stats
        const yachtsMap = new Map<string, YachtWithStats>()

        cabins?.forEach((cabin: any) => {
          // Skip STAFF cabins
          if (cabin.status === 'STAFF') return

          const yacht = cabin.yachts
          const yachtId = yacht.id

          if (!yachtsMap.has(yachtId)) {
            yachtsMap.set(yachtId, {
              ...yacht,
              total_cabins: 0,
              available_cabins: 0,
            })
          }

          const yachtStats = yachtsMap.get(yachtId)!
          yachtStats.total_cabins++

          if (cabin.status === 'Available' || cabin.status === 'Half Available') {
            yachtStats.available_cabins++
          }
        })

        setData(Array.from(yachtsMap.values()))
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch yachts'))
        setData(null)
      } finally {
        setLoading(false)
      }
    }

    fetchYachts()
  }, [tripId])

  return { data, loading, error }
}
