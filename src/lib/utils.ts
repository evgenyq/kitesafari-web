// Date formatting helpers

export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function formatDateRange(startDate: string, endDate: string): string {
  return `${formatDate(startDate)} - ${formatDate(endDate)}`
}

// Cabin status helpers

export function getStatusColor(status: string): string {
  switch (status) {
    case 'Available':
      return '#22C55E' // green
    case 'Booked':
      return '#EF4444' // red
    case 'Half Available':
      return '#EAB308' // yellow
    case 'STAFF':
      return '#94A3B8' // gray
    default:
      return '#94A3B8'
  }
}

export function getStatusText(status: string): string {
  switch (status) {
    case 'Available':
      return 'Свободна'
    case 'Booked':
      return 'Забронирована'
    case 'Half Available':
      return 'Половина свободна'
    case 'STAFF':
      return 'Персонал'
    default:
      return status
  }
}

// Price formatting

export function formatPrice(price: number): string {
  return `€${price.toLocaleString('ru-RU')}`
}

// Image helpers

export function getFirstImage(urls: string[] | null): string | null {
  return urls && urls.length > 0 ? urls[0] : null
}

export function getPlaceholderImage(): string {
  return '/placeholder.jpg'
}
