import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Cabin, CabinStatus } from '../types'

interface RealtimeCabinState {
  cabin: Cabin | null
  status: CabinStatus | null
  isStatusChanged: boolean
  isLoading: boolean
  error: Error | null
}

/**
 * Hook to monitor cabin status changes in real-time
 * Subscribes to Supabase Realtime updates for a specific cabin
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

    // Fetch initial cabin data
    const fetchInitialCabin = async () => {
      try {
        const { data, error } = await supabase
          .from('cabins')
          .select('*')
          .eq('id', cabin_id)
          .single<Cabin>()

        if (error) throw error

        if (data) {
          initialStatus = data.status
          setState({
            cabin: data,
            status: data.status,
            isStatusChanged: false,
            isLoading: false,
            error: null,
          })
        }
      } catch (err) {
        console.error('Error fetching cabin:', err)
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: err as Error,
        }))
      }
    }

    fetchInitialCabin()

    // Subscribe to real-time updates
    const channel = supabase
      .channel(`cabin-${cabin_id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'cabins',
          filter: `id=eq.${cabin_id}`,
        },
        (payload) => {
          console.log('Realtime cabin update:', payload)

          const newCabin = payload.new as Cabin
          const newStatus = newCabin.status

          // Check if status actually changed from initial
          const statusChanged = initialStatus !== null && newStatus !== initialStatus

          setState({
            cabin: newCabin,
            status: newStatus,
            isStatusChanged: statusChanged,
            isLoading: false,
            error: null,
          })
        }
      )
      .subscribe((status) => {
        console.log(`Realtime subscription status for cabin ${cabin_id}:`, status)
      })

    // Cleanup subscription on unmount or cabin_id change
    return () => {
      console.log(`Unsubscribing from cabin ${cabin_id}`)
      supabase.removeChannel(channel)
    }
  }, [cabin_id])

  return state
}
