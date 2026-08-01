import { Dish, Ingredient, Nutrient } from '../dishes'
import { MealLog } from './types'

interface DecodedMealLogDishes {
  dishIds: string[]
  dishSnapshots: Record<string, Dish>
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'val' in value) {
    const scalar = (value as { val: unknown }).val
    if (typeof scalar === 'string') return scalar
  }
  return undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readQuantity(value: unknown): string {
  return readString(value) ?? (readNumber(value)?.toString() || '')
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const text = readString(item)
    return text === undefined ? [] : [text]
  })
}

function readIngredients(value: unknown): Ingredient[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const ingredient = item as Record<string, unknown>
    const name = readString(ingredient.name)
    if (!name) return []

    return [{
      name,
      quantity: readQuantity(ingredient.quantity),
      unit: readString(ingredient.unit) ?? '',
    }]
  })
}

function readNutrients(value: unknown): Nutrient[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const nutrient = item as Record<string, unknown>
    const name = readString(nutrient.name)
    const amount = readNumber(nutrient.amount)
    if (!name || amount === undefined) return []

    return [{ name, amount, unit: readString(nutrient.unit) ?? '' }]
  })
}

function readDishSnapshot(value: unknown): Dish | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const snapshot = value as Record<string, unknown>
  const id = readString(snapshot.id)
  const name = readString(snapshot.name)
  if (!id || !name) return undefined

  return {
    id,
    name,
    instructions: readString(snapshot.instructions) ?? '',
    prepTime: readNumber(snapshot.prep_time ?? snapshot.prepTime),
    cookTime: readNumber(snapshot.cook_time ?? snapshot.cookTime),
    servings: readNumber(snapshot.servings),
    tags: readStringList(snapshot.tags),
    ingredients: readIngredients(snapshot.ingredients),
    nutrients: readNutrients(snapshot.nutrients),
    createdAt: readString(snapshot.created_at ?? snapshot.createdAt) ?? '',
    updatedAt: readString(snapshot.updated_at ?? snapshot.updatedAt) ?? '',
  }
}

export function decodeMealLogDishes(value: unknown): DecodedMealLogDishes {
  if (!Array.isArray(value)) return { dishIds: [], dishSnapshots: {} }

  const dishIds: string[] = []
  const dishSnapshots: Record<string, Dish> = {}

  for (const item of value) {
    const dishId = readString(item)
    if (dishId !== undefined) {
      dishIds.push(dishId)
      continue
    }

    const snapshot = readDishSnapshot(item)
    if (snapshot) {
      dishIds.push(snapshot.id)
      dishSnapshots[snapshot.id] = snapshot
    }
  }

  return { dishIds, dishSnapshots }
}

export function resolveMealLogDish(
  log: MealLog,
  dishId: string,
  getDish: (id: string) => Dish | undefined,
): Dish | undefined {
  return log.dishSnapshots?.[dishId] ?? getDish(dishId)
}
