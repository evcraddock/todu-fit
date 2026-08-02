import { WaterEntry } from './types'

export interface WaterHistoryDay {
  date: string
  entries: WaterEntry[]
  totalMl: number
}

export function isValidIanaTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
    return timezone.length > 0
  } catch {
    return false
  }
}

export function detectIanaTimezone(): string {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
  return isValidIanaTimezone(detected) ? detected : 'UTC'
}

export function resolveIanaTimezone(timezone: string): string {
  return isValidIanaTimezone(timezone) ? timezone : detectIanaTimezone()
}

export function dateStringInTimezone(value: string | Date, timezone: string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime()) || !isValidIanaTimezone(timezone)) return ''

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function shiftDateString(dateString: string, days: number): string {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function buildWaterHistory(
  entries: WaterEntry[],
  from: string,
  to: string,
  timezone: string,
): WaterHistoryDay[] {
  if (!from || !to || from > to || !isValidIanaTimezone(timezone)) return []

  const entriesByDate = new Map<string, WaterEntry[]>()
  for (const entry of entries) {
    const date = dateStringInTimezone(entry.consumedAt, timezone)
    if (date < from || date > to) continue
    const dayEntries = entriesByDate.get(date) ?? []
    dayEntries.push(entry)
    entriesByDate.set(date, dayEntries)
  }

  const days: WaterHistoryDay[] = []
  for (let date = from; date <= to; date = shiftDateString(date, 1)) {
    const dayEntries = (entriesByDate.get(date) ?? [])
      .slice()
      .sort((a, b) => a.consumedAt.localeCompare(b.consumedAt))
    days.push({
      date,
      entries: dayEntries,
      totalMl: dayEntries.reduce((sum, entry) => sum + entry.amountMl, 0),
    })
  }
  return days
}

export function formatTimestampInTimezone(value: string, timezone: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}
