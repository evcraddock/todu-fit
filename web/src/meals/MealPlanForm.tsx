import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useRepoState, RepoLoading } from '../repo'
import { useMealPlans } from './useMealPlans'
import { useDishes } from '../dishes/useDishes'
import { MealPlan, MealType, MEAL_TYPES, MEAL_TYPE_LABELS } from './types'
import { DishSelector } from './DishSelector'

// Get today's date in YYYY-MM-DD format
function getTodayDate(): string {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function MealPlanForm() {
  const { isReady } = useRepoState()

  if (!isReady) {
    return <RepoLoading />
  }

  return <MealPlanFormContent />
}

function MealPlanFormContent() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { getMealPlan, addMealPlan, updateMealPlan, isLoading: plansLoading } = useMealPlans()
  const { dishes, isLoading: dishesLoading } = useDishes()

  const isLoading = plansLoading || dishesLoading
  const isEdit = Boolean(id)
  const existingPlan = id ? getMealPlan(id) : undefined

  // Form state - initialize from URL params for new plans
  const [date, setDate] = useState(searchParams.get('date') || getTodayDate())
  const [mealType, setMealType] = useState<MealType>(
    (searchParams.get('type') as MealType) || 'dinner'
  )
  const [title, setTitle] = useState('')
  const [cook, setCook] = useState('')
  const [selectedDishIds, setSelectedDishIds] = useState<string[]>([])
  const [usesLeftovers, setUsesLeftovers] = useState(false)

  // Load existing plan data
  useEffect(() => {
    if (existingPlan) {
      setDate(existingPlan.date)
      setMealType(existingPlan.mealType)
      setTitle(existingPlan.title)
      setCook(existingPlan.cook)
      setSelectedDishIds(existingPlan.dishIds)
      setUsesLeftovers(existingPlan.usesLeftovers)
    }
  }, [id, isLoading])

  const handleToggleDish = (dishId: string) => {
    if (selectedDishIds.includes(dishId)) {
      setSelectedDishIds(selectedDishIds.filter((id) => id !== dishId))
    } else {
      setSelectedDishIds([...selectedDishIds, dishId])
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const now = new Date().toISOString()

    // Generate default title if not provided
    const finalTitle = title.trim() || `${MEAL_TYPE_LABELS[mealType]} on ${date}`

    if (isEdit && id) {
      updateMealPlan(id, {
        date,
        mealType,
        title: finalTitle,
        cook: cook.trim(),
        dishIds: selectedDishIds,
        usesLeftovers,
      })
      navigate(`/meals/${date}`)
    } else {
      const newPlan: MealPlan = {
        id: uuidv4(),
        date,
        mealType,
        title: finalTitle,
        cook: cook.trim(),
        dishIds: selectedDishIds,
        usesLeftovers,
        createdAt: now,
        updatedAt: now,
      }
      addMealPlan(newPlan)
      navigate(`/meals/${date}`)
    }
  }

  if (isLoading) {
    return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
  }

  if (isEdit && !existingPlan) {
    return (
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow p-8 transition-colors">
        <p className="text-gray-500 dark:text-gray-400 text-center">
          Meal plan not found.{' '}
          <Link to="/meals" className="text-blue-600 dark:text-blue-400 hover:underline">
            Back to calendar
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow p-4 sm:p-8 transition-colors">
      <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-gray-100">
        {isEdit ? 'Edit Meal Plan' : 'New Meal Plan'}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Date & Meal Type */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="date" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
              Date *
            </label>
            <input
              type="date"
              id="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full px-4 py-3 min-h-[44px] border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>
          <div>
            <label htmlFor="mealType" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
              Meal Type *
            </label>
            <select
              id="mealType"
              value={mealType}
              onChange={(e) => setMealType(e.target.value as MealType)}
              className="w-full px-4 py-3 min-h-[44px] border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {MEAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {MEAL_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Title & Cook */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="title" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
              Title (optional)
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`${MEAL_TYPE_LABELS[mealType]} on ${date}`}
              className="w-full px-4 py-3 min-h-[44px] border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>
          <div>
            <label htmlFor="cook" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
              Cook (optional)
            </label>
            <input
              type="text"
              id="cook"
              value={cook}
              onChange={(e) => setCook(e.target.value)}
              placeholder="Who's cooking?"
              className="w-full px-4 py-3 min-h-[44px] border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>
        </div>

        <div>
          <label className="flex items-start gap-3 rounded-lg border border-gray-300 dark:border-gray-600 p-4 cursor-pointer">
            <input
              type="checkbox"
              checked={usesLeftovers}
              onChange={(e) => setUsesLeftovers(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 dark:border-gray-500 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                This meal uses leftovers
              </span>
              <span className="block text-sm text-gray-500 dark:text-gray-400">
                Leftover meals stay on the plan, but their dishes won&apos;t add fresh ingredients to the shopping cart.
              </span>
            </div>
          </label>
        </div>

        {/* Dish Selector */}
        <fieldset className="border border-gray-300 dark:border-gray-600 rounded-lg p-4">
          <legend className="text-sm font-medium px-2 text-gray-700 dark:text-gray-300">Select Dishes</legend>
          <DishSelector
            dishes={dishes}
            selectedDishIds={selectedDishIds}
            onToggleDish={handleToggleDish}
            colorTheme="blue"
          />
        </fieldset>

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 sm:gap-4 pt-4">
          <Link
            to={isEdit ? `/meals/${date}` : '/meals'}
            className="px-4 py-3 min-h-[44px] bg-gray-600 dark:bg-gray-700 text-white rounded-lg hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors text-center"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="px-6 py-3 min-h-[44px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            {isEdit ? 'Save Changes' : 'Create Plan'}
          </button>
        </div>
      </form>
    </div>
  )
}
