import { AvailableNutrition } from './mealPlanNutrition'

interface NutritionInlineProps {
  nutrition: AvailableNutrition
}

function formatAmount(amount: number): string {
  const rounded = Math.round(amount * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function NutritionInline({ nutrition }: NutritionInlineProps) {
  const items = [
    nutrition.calories !== undefined ? `${formatAmount(nutrition.calories)} cal` : null,
    nutrition.protein !== undefined ? `${formatAmount(nutrition.protein)}g protein` : null,
    nutrition.carbs !== undefined ? `${formatAmount(nutrition.carbs)}g carbs` : null,
    nutrition.fat !== undefined ? `${formatAmount(nutrition.fat)}g fat` : null,
  ].filter((item): item is string => item !== null)

  if (items.length === 0) return null

  return (
    <span className="text-xs text-gray-500 dark:text-gray-400">
      {items.join(' · ')}
    </span>
  )
}
