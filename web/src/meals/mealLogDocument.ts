import { CliMealLog } from './types'

export type MealLogsDocument = Record<string, unknown>

function getString(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object' && 'val' in value) {
    return String((value as { val: unknown }).val)
  }
  return ''
}

export function isCliMealLog(entry: unknown): entry is CliMealLog {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return false
  }

  const log = entry as Record<string, unknown>
  return 'date' in log && 'meal_type' in log
}

export function getMealLogEntries(doc: MealLogsDocument): Array<[string, CliMealLog]> {
  const entries = new Map<string, CliMealLog>()

  for (const [id, entry] of Object.entries(doc)) {
    if (id !== 'mealLogs' && isCliMealLog(entry)) {
      entries.set(id, entry)
    }
  }

  const legacyEntries = doc.mealLogs
  if (Array.isArray(legacyEntries)) {
    for (const entry of legacyEntries) {
      if (!isCliMealLog(entry)) continue

      const id = getString((entry as unknown as Record<string, unknown>).id)
      if (id && !entries.has(id)) {
        entries.set(id, entry)
      }
    }
  }

  return [...entries]
}
