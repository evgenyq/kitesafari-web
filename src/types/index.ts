// Database types based on Supabase schema

export interface Trip {
  id: string
  notion_id: string
  name: string
  start_date: string
  end_date: string
  access_code: string
  description: string | null
  terms: string | null
  photos_urls: string[] | null
  status: string
  created_at: string
  updated_at: string
}

// Cabin map types for interactive deck plan
export interface CabinMapCoords {
  cabin_number: number
  left: number
  top: number
  right: number
  bottom: number
}

export interface CabinMap {
  imageWidth: number
  imageHeight: number
  cabins: CabinMapCoords[]
}

export interface Yacht {
  id: string
  notion_id: string
  name: string
  description: string | null
  photos_urls: string[] | null
  deck_plan_urls: string[] | null
  specifications: Record<string, any> | null
  cabin_map: CabinMap | null
  created_at: string
  updated_at: string
}

export interface Cabin {
  id: string
  notion_id: string
  trip_id: string
  yacht_id: string
  cabin_number: number
  deck: string
  bed_type: string
  price: number
  status: CabinStatus
  guests: string | null
  max_guests: number
  created_at: string
  updated_at: string
}

export type CabinStatus = 'Available' | 'Booked' | 'Half Available' | 'STAFF'

// Extended types with joined data

export interface YachtWithStats extends Yacht {
  total_cabins: number
  available_cabins: number
}

export interface CabinWithYacht extends Cabin {
  yacht: Yacht
}

export interface CabinWithCoords extends Cabin {
  coords: CabinMapCoords
}

// Grouped data types

export interface CabinsByDeck {
  [deckName: string]: Cabin[]
}

export interface CabinsByYacht {
  yacht: Yacht
  cabinsByDeck: CabinsByDeck
}

// Hook return types

export interface UseDataResult<T> {
  data: T | null
  loading: boolean
  error: Error | null
}
