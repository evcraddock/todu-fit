export interface ShoppingQuantity {
  quantity: string
  unit: string
}

interface Fraction {
  numerator: number
  denominator: number
}

interface ParsedQuantity {
  fraction: Fraction
  usesFraction: boolean
}

const UNIT_ALIASES: Record<string, string> = {
  tsp: 'tsp',
  tsps: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tbsp: 'tbsp',
  tbsps: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  cup: 'cup',
  cups: 'cup',
  oz: 'oz',
  ozs: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  g: 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  l: 'l',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  each: 'each',
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a)
  let right = Math.abs(b)
  while (right !== 0) {
    const remainder = left % right
    left = right
    right = remainder
  }
  return left || 1
}

function reduce(fraction: Fraction): Fraction {
  const divisor = greatestCommonDivisor(fraction.numerator, fraction.denominator)
  return {
    numerator: fraction.numerator / divisor,
    denominator: fraction.denominator / divisor,
  }
}

function parseQuantity(value: string): ParsedQuantity | null {
  const quantity = value.trim()

  const mixedMatch = quantity.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/)
  if (mixedMatch) {
    const whole = Number(mixedMatch[1])
    const numerator = Number(mixedMatch[2])
    const denominator = Number(mixedMatch[3])
    if (denominator === 0) return null
    return {
      fraction: reduce({ numerator: whole * denominator + numerator, denominator }),
      usesFraction: true,
    }
  }

  const fractionMatch = quantity.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (fractionMatch) {
    const numerator = Number(fractionMatch[1])
    const denominator = Number(fractionMatch[2])
    if (denominator === 0) return null
    return {
      fraction: reduce({ numerator, denominator }),
      usesFraction: true,
    }
  }

  const decimalMatch = quantity.match(/^(\d+)(?:\.(\d*))?$|^\.(\d+)$/)
  if (!decimalMatch) return null

  const whole = decimalMatch[1] ?? '0'
  const decimal = decimalMatch[2] ?? decimalMatch[3] ?? ''
  const denominator = 10 ** decimal.length
  const numerator = Number(whole) * denominator + Number(decimal || '0')
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) return null

  return {
    fraction: reduce({ numerator, denominator }),
    usesFraction: false,
  }
}

function add(left: Fraction, right: Fraction): Fraction {
  return reduce({
    numerator: left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  })
}

function formatFraction(fraction: Fraction): string {
  const whole = Math.floor(fraction.numerator / fraction.denominator)
  const remainder = fraction.numerator % fraction.denominator
  if (remainder === 0) return String(whole)
  if (whole === 0) return `${remainder}/${fraction.denominator}`
  return `${whole} ${remainder}/${fraction.denominator}`
}

function formatDecimal(fraction: Fraction): string {
  return String(fraction.numerator / fraction.denominator)
}

function normalizeUnit(unit: string): { key: string; display: string; original: string } {
  const trimmed = unit.trim().replace(/\s+/g, ' ')
  const lower = trimmed.toLowerCase()
  const alias = UNIT_ALIASES[lower]
  return alias
    ? { key: alias, display: alias, original: trimmed }
    : { key: lower, display: trimmed, original: trimmed }
}

function displayNumericUnit(unit: string, total: Fraction): string {
  if (unit === 'cup' && total.numerator > total.denominator) return 'cups'
  return unit
}

function withUnit(quantity: string, unit: string): string {
  return [quantity, unit].filter(Boolean).join(' ')
}

export function formatShoppingQuantities(quantities: ShoppingQuantity[]): string {
  const groups = new Map<
    string,
    {
      unit: string
      numeric: ParsedQuantity[]
      descriptive: string[]
    }
  >()

  for (const item of quantities) {
    const unit = normalizeUnit(item.unit)
    if (!groups.has(unit.key)) {
      groups.set(unit.key, { unit: unit.display, numeric: [], descriptive: [] })
    }

    const group = groups.get(unit.key)!
    const parsed = parseQuantity(item.quantity)
    if (parsed) {
      group.numeric.push(parsed)
    } else {
      const descriptive = withUnit(item.quantity.trim().replace(/\s+/g, ' '), unit.original)
      if (descriptive) group.descriptive.push(descriptive)
    }
  }

  const parts: string[] = []
  for (const group of groups.values()) {
    if (group.numeric.length > 0) {
      const total = group.numeric.reduce(
        (sum, quantity) => add(sum, quantity.fraction),
        { numerator: 0, denominator: 1 },
      )
      const usesFraction = group.numeric.some((quantity) => quantity.usesFraction)
      const formatted = usesFraction ? formatFraction(total) : formatDecimal(total)
      parts.push(withUnit(formatted, displayNumericUnit(group.unit, total)))
    }
    parts.push(...group.descriptive)
  }

  return parts.join(', ')
}
