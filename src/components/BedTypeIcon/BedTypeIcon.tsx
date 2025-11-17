interface BedTypeIconProps {
  bedType: string
  size?: number
  className?: string
}

export function BedTypeIcon({ bedType, size = 20, className = '' }: BedTypeIconProps) {
  const normalizedType = bedType.toLowerCase().trim()

  // Single bed icon
  if (normalizedType === 'single') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-label="Single bed"
      >
        <rect x="4" y="10" width="16" height="10" rx="1" />
        <rect x="6" y="7" width="12" height="3" rx="0.5" />
        <line x1="4" y1="20" x2="4" y2="22" />
        <line x1="20" y1="20" x2="20" y2="22" />
      </svg>
    )
  }

  // Double bed icon
  if (normalizedType === 'double') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-label="Double bed"
      >
        <rect x="3" y="10" width="18" height="10" rx="1" />
        <rect x="5" y="7" width="6" height="3" rx="0.5" />
        <rect x="13" y="7" width="6" height="3" rx="0.5" />
        <line x1="3" y1="20" x2="3" y2="22" />
        <line x1="21" y1="20" x2="21" y2="22" />
      </svg>
    )
  }

  // Twin beds icon
  if (normalizedType === 'twin') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-label="Twin beds"
      >
        <rect x="2" y="10" width="8" height="8" rx="1" />
        <rect x="3" y="8" width="6" height="2" rx="0.5" />
        <rect x="14" y="10" width="8" height="8" rx="1" />
        <rect x="15" y="8" width="6" height="2" rx="0.5" />
        <line x1="2" y1="18" x2="2" y2="20" />
        <line x1="10" y1="18" x2="10" y2="20" />
        <line x1="14" y1="18" x2="14" y2="20" />
        <line x1="22" y1="18" x2="22" y2="20" />
      </svg>
    )
  }

  // Double + Single combo icon
  if (normalizedType.includes('double') && normalizedType.includes('single')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-label="Double and Single bed"
      >
        <rect x="2" y="4" width="10" height="6" rx="1" />
        <rect x="3" y="2" width="4" height="2" rx="0.5" />
        <rect x="8" y="2" width="3" height="2" rx="0.5" />
        <text x="12" y="9" fontSize="8" fontWeight="bold">+</text>
        <rect x="14" y="14" width="8" height="6" rx="1" />
        <rect x="15" y="12" width="6" height="2" rx="0.5" />
      </svg>
    )
  }

  // Default fallback - generic bed icon
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="Bed"
    >
      <rect x="3" y="10" width="18" height="10" rx="1" />
      <rect x="5" y="7" width="14" height="3" rx="0.5" />
      <line x1="3" y1="20" x2="3" y2="22" />
      <line x1="21" y1="20" x2="21" y2="22" />
    </svg>
  )
}
