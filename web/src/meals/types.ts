export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface MealPlan {
  id: string
  date: string // YYYY-MM-DD
  mealType: MealType
  title: string
  cook: string
  dishIds: string[]
  usesLeftovers: boolean
  createdAt: string
  updatedAt: string
}

// CLI document structure - mealplans stored at root level with snake_case
export interface CliMealPlan {
  id: string
  date: string
  meal_type: MealType
  title: string
  cook: string
  dish_ids: string[] // dish UUIDs
  uses_leftovers?: boolean
  created_by?: string
  created_at: string
  updated_at: string
}

// Document as stored by CLI - UUIDs as keys at root level
export type MealPlansDoc = Record<string, CliMealPlan>

// Meal type display order and colors
export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']

export const MEAL_TYPE_COLORS: Record<MealType, string> = {
  breakfast: 'bg-amber-400',
  lunch: 'bg-green-400',
  dinner: 'bg-blue-400',
  snack: 'bg-purple-400',
}

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
}

// ============================================================
// Meal Log Types (what was actually eaten - user-owned/private)
// ============================================================

export interface MealLog {
  id: string
  date: string // YYYY-MM-DD
  mealType: MealType
  mealPlanId: string | null // optional link to meal plan
  dishIds: string[]
  notes: string
  createdBy: string
  createdAt: string
}

// CLI document structure - meallogs stored at root level with snake_case
export interface CliMealLog {
  date: string
  meal_type: MealType
  mealplan_id?: string | null
  dishes: string[] // dish UUIDs
  notes?: string | null
  created_by: string
  created_at: string
}

// Document as stored by CLI - UUIDs as keys at root level
export type MealLogsDoc = Record<string, CliMealLog>

// Nutrition summary for daily totals
export interface NutritionSummary {
  calories: number
  protein: number
  carbs: number
  fat: number
}

// ============================================================
// Shopping Cart Types (weekly shopping lists)
// ============================================================

export interface ManualShoppingItem {
  name: string
  quantity: string
  unit: string
}

// CLI document structure for a single week's shopping cart
export interface CliShoppingCart {
  checked: string[]  // lowercase item names that are checked
  manual_items: ManualShoppingItem[]
}

// Document as stored - week start dates as keys (e.g., "2026-01-11")
export type ShoppingCartsDoc = Record<string, CliShoppingCart>
