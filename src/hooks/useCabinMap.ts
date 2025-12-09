import type { Yacht, Cabin, CabinWithCoords } from '../types'

/**
 * Merges cabin_map coordinates with cabin data
 * Returns null if yacht doesn't have cabin_map
 */
export function useCabinMap(yacht: Yacht, cabins: Cabin[]): CabinWithCoords[] | null {
  if (!yacht.cabin_map) {
    return null
  }

  const cabinsWithCoords: CabinWithCoords[] = []

  // For each coordinate in the map, find the matching cabin
  yacht.cabin_map.cabins.forEach(coords => {
    // Convert both to numbers for comparison (cabin_number might be string in DB)
    const cabin = cabins.find(c => Number(c.cabin_number) === Number(coords.cabin_number))

    if (cabin) {
      cabinsWithCoords.push({
        ...cabin,
        coords
      })
    }
  })

  return cabinsWithCoords
}
