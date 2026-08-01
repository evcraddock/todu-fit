import { Dish } from '../dishes'
import { MealPlan, NutritionSummary } from './types'

export type AvailableNutrition = Partial<NutritionSummary>

function nutrientKey(name: string): keyof NutritionSummary | null {
  switch (name.trim().toLowerCase()) {
    case 'calories':
    case 'kcal':
      return 'calories'
    case 'protein':
      return 'protein'
    case 'carbs':
    case 'carbohydrates':
      return 'carbs'
    case 'fat':
      return 'fat'
    default:
      return null
  }
}

export function calculateDishNutrition(dish: Dish): AvailableNutrition {
  const nutrition: AvailableNutrition = {}

  for (const nutrient of dish.nutrients ?? []) {
    const key = nutrientKey(nutrient.name)
    if (!key || !Number.isFinite(nutrient.amount) || nutrient.amount < 0) continue
    nutrition[key] = (nutrition[key] ?? 0) + nutrient.amount
  }

  return nutrition
}

function emptyNutrition(): NutritionSummary {
  return { calories: 0, protein: 0, carbs: 0, fat: 0 }
}

function addNutrition(total: NutritionSummary, nutrition: AvailableNutrition): void {
  total.calories += nutrition.calories ?? 0
  total.protein += nutrition.protein ?? 0
  total.carbs += nutrition.carbs ?? 0
  total.fat += nutrition.fat ?? 0
}

export function calculateMealPlanNutrition(
  plan: MealPlan,
  getDish: (id: string) => Dish | undefined,
): NutritionSummary {
  const total = emptyNutrition()

  for (const dishId of plan.dishIds) {
    const dish = getDish(dishId)
    if (dish) addNutrition(total, calculateDishNutrition(dish))
  }

  return total
}

export function calculateDailyPlanNutrition(
  plans: MealPlan[],
  getDish: (id: string) => Dish | undefined,
): NutritionSummary {
  const total = emptyNutrition()

  for (const plan of plans) {
    addNutrition(total, calculateMealPlanNutrition(plan, getDish))
  }

  return total
}
