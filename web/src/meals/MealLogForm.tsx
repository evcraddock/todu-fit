import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useRepoState, RepoLoading } from '../repo'
import { useAuth } from '../auth'
import { useMealLogs } from './useMealLogs'
import { useMealPlans } from './useMealPlans'
import { useDishes } from '../dishes/useDishes'
import { MealLog, MealType, MEAL_TYPES, MEAL_TYPE_LABELS } from './types'
import { DishSelector } from './DishSelector'
import { normalizeDishPortions } from './mealLogPortions'

// Get today's date in YYYY-MM-DD format
function getTodayDate(): string {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function MealLogForm() {
  const { isReady } = useRepoState()

  if (!isReady) {
    return <RepoLoading />
  }

  return <MealLogFormContent />
}

function MealLogFormContent() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { auth } = useAuth()
  const { getMealLog, addMealLog, updateMealLog, isLoading: logsLoading } = useMealLogs()
  const { getPlansForDate, isLoading: plansLoading } = useMealPlans()
  const { dishes, isLoading: dishesLoading } = useDishes()

  const isLoading = logsLoading || dishesLoading || plansLoading
  const isEdit = Boolean(id)
  const existingLog = id ? getMealLog(id) : undefined

  // Form state - initialize from URL params for new logs
  const [date, setDate] = useState(searchParams.get('date') || getTodayDate())
  const [mealType, setMealType] = useState<MealType>(
    (searchParams.get('type') as MealType) || 'dinner'
  )
  const [selectedDishIds, setSelectedDishIds] = useState<string[]>([])
  const [dishPortions, setDishPortions] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState('')
  const [showLogFromPlan, setShowLogFromPlan] = useState(false)

  // Load existing log data
  useEffect(() => {
    if (existingLog) {
      setDate(existingLog.date)
      setMealType(existingLog.mealType)
      setSelectedDishIds(existingLog.dishIds)
      setDishPortions(normalizeDishPortions(existingLog.dishIds, existingLog.dishPortions))
      setNotes(existingLog.notes)
    }
  }, [id, isLoading])

  // Get planned meals for this date/type (for "Log from Plan" feature)
  const plannedMeals = getPlansForDate(date).filter(p => p.mealType === mealType)

  const handleToggleDish = (dishId: string) => {
    if (selectedDishIds.includes(dishId)) {
      setSelectedDishIds(selectedDishIds.filter((id) => id !== dishId))
      setDishPortions(({ [dishId]: _removed, ...remaining }) => remaining)
    } else {
      setSelectedDishIds([...selectedDishIds, dishId])
      setDishPortions({ ...dishPortions, [dishId]: 1 })
    }
  }

  const handleLogFromPlan = (planDishIds: string[]) => {
    // Add all dishes from the plan that aren't already selected
    const newDishIds = [...selectedDishIds]
    for (const dishId of planDishIds) {
      if (!newDishIds.includes(dishId)) {
        newDishIds.push(dishId)
      }
    }
    setSelectedDishIds(newDishIds)
    setDishPortions(normalizeDishPortions(newDishIds, dishPortions))
    setShowLogFromPlan(false)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const now = new Date().toISOString()

    const normalizedPortions = normalizeDishPortions(selectedDishIds, dishPortions)

    if (isEdit && id) {
      updateMealLog(id, {
        date,
        mealType,
        dishIds: selectedDishIds,
        dishPortions: normalizedPortions,
        notes: notes.trim(),
      })
      navigate(`/log/${date}`)
    } else {
      const newLog: MealLog = {
        id: crypto.randomUUID(),
        date,
        mealType,
        mealPlanId: null,
        dishIds: selectedDishIds,
        dishPortions: normalizedPortions,
        notes: notes.trim(),
        createdBy: auth?.userId || 'unknown',
        createdAt: now,
      }
      addMealLog(newLog)
      navigate(`/log/${date}`)
    }
  }

  if (isLoading) {
    return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
  }

  if (isEdit && !existingLog) {
    return (
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow p-8 transition-colors">
        <p className="text-gray-500 dark:text-gray-400 text-center">
          Meal log not found.{' '}
          <Link to="/log" className="text-blue-600 dark:text-blue-400 hover:underline">
            Back to logs
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow p-4 sm:p-8 transition-colors">
      <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-gray-100">
        {isEdit ? 'Edit Meal Log' : 'Log a Meal'}
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

        {/* Log from Plan */}
        {plannedMeals.length > 0 && !isEdit && (
          <div className="border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30 rounded p-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-medium text-green-800 dark:text-green-300">
                Planned for {MEAL_TYPE_LABELS[mealType]}
              </h3>
              <button
                type="button"
                onClick={() => setShowLogFromPlan(!showLogFromPlan)}
                className="text-sm text-green-600 dark:text-green-400 hover:underline"
              >
                {showLogFromPlan ? 'Hide' : 'Log from plan'}
              </button>
            </div>
            {showLogFromPlan && (
              <div className="space-y-2">
                {plannedMeals.map((plan) => (
                  <div
                    key={plan.id}
                    className="flex justify-between items-center bg-white dark:bg-gray-800 p-2 rounded border border-green-200 dark:border-green-700"
                  >
                    <div>
                      <span className="font-medium text-gray-900 dark:text-gray-100">{plan.title}</span>
                      <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                        ({plan.dishIds.length} dish{plan.dishIds.length !== 1 ? 'es' : ''})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleLogFromPlan(plan.dishIds)}
                      className="px-3 py-1 bg-slate-600 text-white text-sm rounded hover:bg-slate-700"
                    >
                      Add dishes
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Dish Selector */}
        <fieldset className="border border-gray-300 dark:border-gray-600 rounded p-4">
          <legend className="text-sm font-medium px-2 text-gray-700 dark:text-gray-300">What did you eat?</legend>
          <DishSelector
            dishes={dishes}
            selectedDishIds={selectedDishIds}
            onToggleDish={handleToggleDish}
            colorTheme="green"
          />
          {selectedDishIds.length > 0 && (
            <div className="mt-4 space-y-3">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Servings eaten</p>
              {selectedDishIds.map((dishId) => {
                const dish = dishes.find((candidate) => candidate.id === dishId)
                return (
                  <div key={dishId} className="flex items-center justify-between gap-4">
                    <label
                      htmlFor={`portion-${dishId}`}
                      className="text-sm text-gray-700 dark:text-gray-300"
                    >
                      {dish?.name ?? 'Unknown dish'}
                    </label>
                    <input
                      id={`portion-${dishId}`}
                      type="number"
                      min="0.01"
                      step="any"
                      required
                      value={dishPortions[dishId] ?? 1}
                      onChange={(event) => {
                        const portion = event.target.valueAsNumber
                        setDishPortions({
                          ...dishPortions,
                          [dishId]: Number.isNaN(portion) ? 0 : portion,
                        })
                      }}
                      aria-label={`Servings eaten for ${dish?.name ?? 'unknown dish'}`}
                      className="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                )
              })}
            </div>
          )}
        </fieldset>

        {/* Notes */}
        <div>
          <label htmlFor="notes" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
            Notes (optional)
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any notes about this meal..."
            rows={3}
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
        </div>

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 sm:gap-4 pt-4">
          <Link
            to={isEdit ? `/log/${date}` : '/log'}
            className="px-4 py-3 min-h-[44px] bg-gray-600 dark:bg-gray-700 text-white rounded-lg hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors text-center"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="px-6 py-3 min-h-[44px] bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors font-medium"
          >
            {isEdit ? 'Save Changes' : 'Log Meal'}
          </button>
        </div>
      </form>
    </div>
  )
}
