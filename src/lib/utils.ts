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
  const start = new Date(startDate)
  const end = new Date(endDate)

  const startDay = start.getDate()
  const endDay = end.getDate()

  // Месяцы в родительном падеже
  const monthsGenitive = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ]

  const startMonth = monthsGenitive[start.getMonth()]
  const endMonth = monthsGenitive[end.getMonth()]

  const startYear = start.getFullYear()
  const endYear = end.getFullYear()

  // Один месяц и год: "2-9 мая 2026"
  if (start.getMonth() === end.getMonth() && startYear === endYear) {
    return `${startDay}-${endDay} ${startMonth} ${startYear}`
  }

  // Разные месяцы, один год: "29 октября - 4 ноября 2027"
  if (startYear === endYear) {
    return `${startDay} ${startMonth} - ${endDay} ${endMonth} ${startYear}`
  }

  // Разные годы: "29 декабря 2026 - 4 января 2027"
  return `${startDay} ${startMonth} ${startYear} - ${endDay} ${endMonth} ${endYear}`
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
  // Return a simple gray SVG placeholder as data URL
  return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="400"%3E%3Crect width="800" height="400" fill="%23e5e7eb"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="24" fill="%239ca3af"%3ENo image%3C/text%3E%3C/svg%3E'
}
