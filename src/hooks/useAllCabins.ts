import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Cabin, Yacht } from '../types'

interface CabinsByYacht {
  yacht: Yacht
  cabinsByDeck: Record<string, Cabin[]>
}

/**
 * Hook to fetch ALL cabins including STAFF (for admin use)
 */
export function useAllCabins(tripId: string | undefined) {
  const [data, setData] = useState<CabinsByYacht[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!tripId) {
      setLoading(false)
      return
    }

    const fetchCabins = async () => {
      try {
        setLoading(true)

        // Get cabins with yachts for this trip (NO STATUS FILTER)
        const { data: cabins, error: cabinsError } = await supabase
          .from('cabins')
          .select(`
            *,
            yachts!inner(*)
          `)
          .eq('yachts.trip_id', tripId)
          .order('cabin_number', { ascending: true })

        if (cabinsError) throw cabinsError

        // Group cabins by yacht and deck
        const cabinsByYacht: Record<string, CabinsByYacht> = {}

        cabins?.forEach((cabin: any) => {
          const yacht = cabin.yachts
          const yachtId = yacht.id

          if (!cabinsByYacht[yachtId]) {
            cabinsByYacht[yachtId] = {
              yacht,
              cabinsByDeck: {},
            }
          }

          const deck = cabin.deck || 'Unknown Deck'
          if (!cabinsByYacht[yachtId].cabinsByDeck[deck]) {
            cabinsByYacht[yachtId].cabinsByDeck[deck] = []
          }

          cabinsByYacht[yachtId].cabinsByDeck[deck].push(cabin)
        })

        setData(Object.values(cabinsByYacht))
        setError(null)
      } catch (err) {
        console.error('Error fetching cabins:', err)
        setError(err instanceof Error ? err : new Error('Failed to fetch cabins'))
      } finally {
        setLoading(false)
      }
    }

    fetchCabins()
  }, [tripId])

  return { data, loading, error }
}
