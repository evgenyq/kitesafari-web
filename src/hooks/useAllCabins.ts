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
        setError(null)

        // Fetch all cabins with yacht info (NO STATUS FILTER for admin)
        const { data: cabins, error: fetchError } = await supabase
          .from('cabins')
          .select('*, yachts(*)')
          .eq('trip_id', tripId)
          .order('cabin_number', { ascending: true })

        if (fetchError) throw fetchError

        // Group by yacht and deck
        const yachtsMap = new Map<string, CabinsByYacht>()

        cabins?.forEach((cabin: any) => {
          // NO FILTER - include ALL cabins including STAFF
          const yacht = cabin.yachts
          const yachtId = yacht.id
          const deck = cabin.deck

          if (!yachtsMap.has(yachtId)) {
            yachtsMap.set(yachtId, {
              yacht,
              cabinsByDeck: {},
            })
          }

          const yachtData = yachtsMap.get(yachtId)!

          if (!yachtData.cabinsByDeck[deck]) {
            yachtData.cabinsByDeck[deck] = []
          }

          yachtData.cabinsByDeck[deck].push({
            id: cabin.id,
            notion_id: cabin.notion_id,
            trip_id: cabin.trip_id,
            yacht_id: cabin.yacht_id,
            cabin_number: cabin.cabin_number,
            deck: cabin.deck,
            bed_type: cabin.bed_type,
            price: cabin.price,
            status: cabin.status,
            guests: cabin.guests,
            max_guests: cabin.max_guests,
            created_at: cabin.created_at,
            updated_at: cabin.updated_at,
          })
        })

        setData(Array.from(yachtsMap.values()))
      } catch (err) {
        console.error('Error fetching cabins:', err)
        setError(err instanceof Error ? err : new Error('Failed to fetch cabins'))
        setData(null)
      } finally {
        setLoading(false)
      }
    }

    fetchCabins()
  }, [tripId])

  return { data, loading, error }
}
