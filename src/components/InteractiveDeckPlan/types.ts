import type { Cabin, Yacht } from '../../types'

export interface InteractiveDeckPlanProps {
  yacht: Yacht
  cabins: Cabin[]
  isOpen: boolean
  onClose: () => void
  onBookCabin: (cabin: Cabin) => void
}

export interface PanzoomState {
  scale: number
  x: number
  y: number
}
