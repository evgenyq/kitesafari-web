import { useEffect, useRef, useState } from 'react'
import Panzoom from '@panzoom/panzoom'
import { CabinMarker } from './CabinMarker'
import { CabinPopup } from './CabinPopup'
import { useCabinMap } from '../../hooks/useCabinMap'
import { getFirstImage } from '../../lib/utils'
import type { Cabin } from '../../types'
import type { InteractiveDeckPlanProps } from './types'
import styles from './InteractiveDeckPlan.module.css'

export function InteractiveDeckPlan({
  yacht,
  cabins,
  isOpen,
  onClose,
  onBookCabin,
}: InteractiveDeckPlanProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const panzoomInstanceRef = useRef<any>(null)
  const [selectedCabin, setSelectedCabin] = useState<Cabin | null>(null)

  const cabinsWithCoords = useCabinMap(yacht, cabins)
  const deckPlanUrl = getFirstImage(yacht.deck_plan_urls)

  useEffect(() => {
    if (!isOpen || !containerRef.current || !deckPlanUrl) return

    // Initialize Panzoom
    const panzoomInstance = Panzoom(containerRef.current, {
      maxScale: 4,
      minScale: 1,
      startScale: 2,
      contain: 'outside',
      cursor: 'grab',
      canvas: true,
      panOnlyWhenZoomed: false,
    })

    panzoomInstanceRef.current = panzoomInstance

    // Enable wheel zoom
    const parent = containerRef.current.parentElement
    if (parent) {
      parent.addEventListener('wheel', panzoomInstance.zoomWithWheel)
    }

    return () => {
      panzoomInstance.destroy()
      panzoomInstanceRef.current = null
    }
  }, [isOpen, deckPlanUrl])

  // Close popup on pan/zoom
  useEffect(() => {
    if (!panzoomInstanceRef.current) return

    const handlePanzoomChange = () => {
      setSelectedCabin(null)
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener('panzoomchange', handlePanzoomChange)
      return () => {
        container.removeEventListener('panzoomchange', handlePanzoomChange)
      }
    }
  }, [isOpen])

  const handleZoomIn = () => {
    panzoomInstanceRef.current?.zoomIn()
  }

  const handleZoomOut = () => {
    panzoomInstanceRef.current?.zoomOut()
  }

  const handleReset = () => {
    panzoomInstanceRef.current?.reset()
  }

  const handleCabinClick = (cabin: Cabin) => {
    setSelectedCabin(cabin)
  }

  const handleBookClick = (cabin: Cabin) => {
    setSelectedCabin(null)
    onBookCabin(cabin)
  }

  if (!isOpen || !deckPlanUrl || !cabinsWithCoords) {
    return null
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.header}>
        <h2 className={styles.title}>🛥️ {yacht.name} - Deck Plan</h2>
        <button
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className={styles.deckPlanWrapper}>
        <div className={styles.deckPlanContainer} ref={containerRef}>
          <img
            src={deckPlanUrl}
            alt={`${yacht.name} Deck Plan`}
            className={styles.deckPlanImage}
          />

          {cabinsWithCoords.map((cabin) => (
            <CabinMarker
              key={cabin.id}
              cabin={cabin}
              imageWidth={yacht.cabin_map!.imageWidth}
              imageHeight={yacht.cabin_map!.imageHeight}
              onClick={handleCabinClick}
            />
          ))}
        </div>

        <div className={styles.zoomControls}>
          <button
            className={styles.zoomButton}
            onClick={handleZoomIn}
            title="Увеличить"
          >
            +
          </button>
          <button
            className={styles.zoomButton}
            onClick={handleZoomOut}
            title="Уменьшить"
          >
            −
          </button>
          <button
            className={styles.zoomButton}
            onClick={handleReset}
            title="Сбросить"
          >
            ⟲
          </button>
        </div>
      </div>

      {selectedCabin && (
        <CabinPopup
          cabin={selectedCabin}
          onClose={() => setSelectedCabin(null)}
          onBook={handleBookClick}
        />
      )}
    </div>
  )
}
