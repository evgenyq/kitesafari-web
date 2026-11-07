import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PUBLIC_CABIN_COLUMNS } from '../lib/cabinGuests'
import type { Cabin, CabinStatus } from '../types'

interface RealtimeCabinState {
  cabin: Cabin | null
  status: CabinStatus | null
  isStatusChanged: boolean
  isLoading: boolean
  error: Error | null
}

const POLL_INTERVAL_MS = 5000

/**
 * Hook to monitor cabin status changes while the booking modal is open
 * Polls the cabin every POLL_INTERVAL_MS. Supabase Realtime is off for cabins:
 * its payload would include guest names (see migration 008).
 *
 * Usage:
 * ```tsx
 * const { cabin, status, isStatusChanged } = useRealtimeCabin(cabin.id)
 *
 * useEffect(() => {
 *   if (isStatusChanged && status !== 'Available') {
 *     alert('Cabin was just booked by someone else!')
 *     closeModal()
 *   }
 * }, [isStatusChanged, status])
 * ```
 */
export function useRealtimeCabin(cabin_id: string | null): RealtimeCabinState {
  const [state, setState] = useState<RealtimeCabinState>({
    cabin: null,
    status: null,
    isStatusChanged: false,
    isLoading: true,
    error: null,
  })

  useEffect(() => {
    if (!cabin_id) {
      setState({
        cabin: null,
        status: null,
        isStatusChanged: false,
        isLoading: false,
        error: null,
      })
      return
    }

    let initialStatus: CabinStatus | null = null
    let cancelled = false

    const fetchCabin = async () => {
      try {
        const { data, error } = await supabase
          .from('cabins')
          .select(PUBLIC_CABIN_COLUMNS)
          .eq('id', cabin_id)
          .single<Omit<Cabin, 'guests'>>()

        if (error) throw error
        if (cancelled || !data) return

        if (initialStatus === null) initialStatus = data.status

        setState({
          cabin: { ...data, guests: null },
          status: data.status,
          isStatusChanged: data.status !== initialStatus,
          isLoading: false,
          error: null,
        })
      } catch (err) {
        console.error('Error fetching cabin:', err)
        if (cancelled) return
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: err as Error,
        }))
      }
    }

    fetchCabin()
    const timer = setInterval(fetchCabin, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [cabin_id])

  return state
}
