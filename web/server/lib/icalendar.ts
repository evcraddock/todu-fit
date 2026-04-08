/**
 * iCalendar (RFC 5545) generator for meal plans.
 */

import { MealPlanEntry } from './automerge'

// Default meal times (24-hour format)
const MEAL_TIMES: Record<string, { hour: number; minute: number }> = {
  breakfast: { hour: 8, minute: 0 },
  lunch: { hour: 12, minute: 0 },
  snack: { hour: 15, minute: 0 },
  dinner: { hour: 18, minute: 0 },
}

// Duration in minutes for each meal type
const MEAL_DURATION: Record<string, number> = {
  breakfast: 30,
  lunch: 45,
  snack: 15,
  dinner: 60,
}

/**
 * Format a Date as iCalendar datetime (YYYYMMDDTHHMMSS)
 */
function formatDateTime(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    'T' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  )
}

/**
 * Format current time as iCalendar timestamp (for DTSTAMP)
 */
function formatTimestamp(): string {
  return formatDateTime(new Date()) + 'Z'
}

/**
 * Escape text for iCalendar format.
 * Escapes backslashes, semicolons, commas, and newlines.
 */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/**
 * Fold long lines according to RFC 5545 (max 75 octets per line).
 */
function foldLine(line: string): string {
  const maxLen = 75
  if (line.length <= maxLen) return line

  const lines: string[] = []
  let remaining = line

  // First line can be full length
  lines.push(remaining.slice(0, maxLen))
  remaining = remaining.slice(maxLen)

  // Continuation lines start with a space, so effective max is 74
  while (remaining.length > 0) {
    lines.push(' ' + remaining.slice(0, maxLen - 1))
    remaining = remaining.slice(maxLen - 1)
  }

  return lines.join('\r\n')
}

interface DishInfo {
  name: string
  ingredients: string[]
}

interface GenerateCalendarOptions {
  /** Calendar name */
  calendarName: string
  /** Group name for the calendar */
  groupName: string
  /** Base URL of the app (for links back) */
  appUrl?: string
  /** Dish information map (id -> dish data) */
  dishes?: Map<string, DishInfo>
}

/**
 * Generate an iCalendar (.ics) file from meal plans.
 *
 * @param mealPlans - Array of meal plan entries
 * @param options - Generation options
 * @returns iCalendar file content as string
 */
export function generateICalendar(
  mealPlans: MealPlanEntry[],
  options: GenerateCalendarOptions
): string {
  const { calendarName, groupName, appUrl, dishes } = options
  const timestamp = formatTimestamp()

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//todu-fit//Meal Plans//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `X-WR-CALDESC:${escapeText(`Meal plans for ${groupName}`)}`,
  ]

  for (const plan of mealPlans) {
    const mealTime = MEAL_TIMES[plan.mealType.toLowerCase()] || MEAL_TIMES.dinner
    const duration = MEAL_DURATION[plan.mealType.toLowerCase()] || 60

    // Parse the date and set the time
    const [year, month, day] = plan.date.split('-').map(Number)
    const startDate = new Date(year, month - 1, day, mealTime.hour, mealTime.minute)
    const endDate = new Date(startDate.getTime() + duration * 60 * 1000)

    // Build summary (event title)
    const mealTypeDisplay = plan.mealType.charAt(0).toUpperCase() + plan.mealType.slice(1)
    let summary = `${mealTypeDisplay}: ${plan.title}`
    if (plan.usesLeftovers) {
      summary += ' (Leftovers)'
    }

    // Build description
    const descParts: string[] = []

    if (plan.usesLeftovers) {
      descParts.push('Uses leftovers: this meal does not contribute fresh ingredients to the shopping list.')
    }

    if (plan.cook && plan.cook !== 'Unknown') {
      descParts.push(`Cook: ${plan.cook}`)
    }

    // Add dish details if available
    if (dishes && plan.dishIds.length > 0) {
      const dishNames: string[] = []
      const allIngredients: string[] = []

      for (const dishId of plan.dishIds) {
        const dish = dishes.get(dishId)
        if (dish) {
          dishNames.push(dish.name)
          allIngredients.push(...dish.ingredients)
        }
      }

      if (dishNames.length > 0) {
        descParts.push(`Dishes: ${dishNames.join(', ')}`)
      }

      if (allIngredients.length > 0) {
        descParts.push(`Ingredients: ${allIngredients.join(', ')}`)
      }
    }

    if (appUrl) {
      descParts.push(`View in app: ${appUrl}/meals/${plan.date}`)
    }

    const description = descParts.join('\\n\\n')

    // Generate a stable UID for the event
    const uid = `${plan.id}@todu-fit`

    lines.push('BEGIN:VEVENT')
    lines.push(foldLine(`UID:${uid}`))
    lines.push(`DTSTAMP:${timestamp}`)
    lines.push(`DTSTART:${formatDateTime(startDate)}`)
    lines.push(`DTEND:${formatDateTime(endDate)}`)
    lines.push(foldLine(`SUMMARY:${escapeText(summary)}`))

    if (description) {
      lines.push(foldLine(`DESCRIPTION:${escapeText(description)}`))
    }

    // Add categories for filtering
    lines.push(`CATEGORIES:${escapeText(mealTypeDisplay)},Meal Plan`)

    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  // Join with CRLF as per RFC 5545
  return lines.join('\r\n')
}
