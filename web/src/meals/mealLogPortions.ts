import { Dish } from '../dishes'
import { MealLog, NutritionSummary } from './types'

export function getDishPortion(
  dishPortions: Record<string, number>,
  dishId: string,
): number {
  const portion = dishPortions[dishId]
  return Number.isFinite(portion) && portion > 0 ? portion : 1
}

export function readDishPortions(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const portions: Record<string, number> = {}
  for (const [dishId, portion] of Object.entries(value)) {
    if (typeof portion === 'number' && Number.isFinite(portion) && portion > 0) {
      portions[dishId] = portion
    }
  }
  return portions
}

export function normalizeDishPortions(
  dishIds: string[],
  dishPortions: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    dishIds.map((dishId) => [dishId, getDishPortion(dishPortions, dishId)]),
  )
}

export function calculateMealLogNutrition(
  log: MealLog,
  getDish: (id: string) => Dish | undefined,
): NutritionSummary {
  const summary: NutritionSummary = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  }

  for (const dishId of log.dishIds) {
    const dish = getDish(dishId)
    if (!dish) continue

    const portion = getDishPortion(log.dishPortions, dishId)
    for (const nutrient of dish.nutrients) {
      const amount = nutrient.amount * portion
      const name = nutrient.name.toLowerCase()
      if (name === 'calories' || name === 'kcal') {
        summary.calories += amount
      } else if (name === 'protein') {
        summary.protein += amount
      } else if (name === 'carbs' || name === 'carbohydrates') {
        summary.carbs += amount
      } else if (name === 'fat') {
        summary.fat += amount
      }
    }
  }

  return summary
}
