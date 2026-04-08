import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useRepoState, RepoLoading } from '../repo'
import { useMealPlans } from './useMealPlans'
import { useDishes } from '../dishes/useDishes'
import { MEAL_TYPES, MEAL_TYPE_COLORS, MEAL_TYPE_LABELS, MealType, MealPlan } from './types'
import { ConfirmDialog } from '../components'

// Date utilities
function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function DayView() {
  const { isReady } = useRepoState()

  if (!isReady) {
    return <RepoLoading />
  }

  return <DayViewContent />
}

function DayViewContent() {
  const { date } = useParams<{ date: string }>()
  const { getPlansForDate, deleteMealPlan, isLoading: plansLoading } = useMealPlans()
  const { getDish, isLoading: dishesLoading } = useDishes()
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)

  const isLoading = plansLoading || dishesLoading

  // Parse the date
  const currentDate = useMemo(() => {
    if (!date) return new Date()
    return parseDate(date)
  }, [date])

  const dateStr = date || formatDate(new Date())
  const prevDate = formatDate(addDays(currentDate, -1))
  const nextDate = formatDate(addDays(currentDate, 1))

  // Get plans for this date
  const plans = useMemo(() => getPlansForDate(dateStr), [getPlansForDate, dateStr])

  // Group plans by meal type
  const plansByMealType = useMemo(() => {
    const grouped: Record<MealType, MealPlan[]> = {
      breakfast: [],
      lunch: [],
      dinner: [],
      snack: [],
    }
    for (const plan of plans) {
      grouped[plan.mealType].push(plan)
    }
    return grouped
  }, [plans])

  // Format date for display
  const displayDate = currentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const handleDelete = (planId: string, planTitle: string) => {
    setDeleteTarget({ id: planId, title: planTitle })
  }

  const confirmDelete = () => {
    if (deleteTarget) {
      deleteMealPlan(deleteTarget.id)
      setDeleteTarget(null)
    }
  }

  if (isLoading) {
    return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 mb-6">
        {/* Date Navigation */}
        <div className="flex items-center justify-between">
          <Link
            to={`/meals/${prevDate}`}
            className="px-3 sm:px-4 py-3 min-h-[44px] bg-gray-600 dark:bg-gray-700 text-white rounded-lg hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
          >
            ←
          </Link>
          <h1 className="text-base sm:text-xl font-semibold text-gray-900 dark:text-gray-100 text-center px-2">{displayDate}</h1>
          <Link
            to={`/meals/${nextDate}`}
            className="px-3 sm:px-4 py-3 min-h-[44px] bg-gray-600 dark:bg-gray-700 text-white rounded-lg hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
          >
            →
          </Link>
        </div>
        {/* Action Buttons */}
        <div className="flex gap-2">
          <Link
            to="/meals"
            className="flex-1 sm:flex-none px-4 py-3 min-h-[44px] bg-gray-600 dark:bg-gray-700 text-white rounded-lg hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors text-center"
          >
            Calendar
          </Link>
          <Link
            to={`/meals/plan/new?date=${dateStr}`}
            className="flex-1 sm:flex-none px-4 py-3 min-h-[44px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-center"
          >
            + Add Meal
          </Link>
        </div>
      </div>

      {/* Meal Sections */}
      <div className="space-y-6">
        {MEAL_TYPES.map((mealType) => {
          const typePlans = plansByMealType[mealType]

          return (
            <div
              key={mealType}
              className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden transition-colors"
            >
              {/* Meal Type Header */}
              <div
                className={`px-4 py-3 flex justify-between items-center ${MEAL_TYPE_COLORS[mealType]} bg-opacity-20 dark:bg-opacity-30`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-3 h-3 rounded-full ${MEAL_TYPE_COLORS[mealType]}`}
                  />
                  <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                    {MEAL_TYPE_LABELS[mealType]}
                  </h2>
                </div>
                <Link
                  to={`/meals/plan/new?date=${dateStr}&type=${mealType}`}
                  className="px-3 py-2 min-h-[44px] flex items-center text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  + Add
                </Link>
              </div>

              {/* Plans */}
              <div className="p-4">
                {typePlans.length === 0 ? (
                  <p className="text-gray-400 text-sm italic">No meal planned</p>
                ) : (
                  <div className="space-y-4">
                    {typePlans.map((plan) => (
                      <div
                        key={plan.id}
                        className="border border-gray-200 dark:border-gray-700 rounded-lg p-3"
                      >
                        <div className="flex flex-col sm:flex-row justify-between items-start gap-2 mb-2">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-medium text-gray-900 dark:text-gray-100">
                                {plan.title}
                              </h3>
                              {plan.usesLeftovers && (
                                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                  Leftovers
                                </span>
                              )}
                            </div>
                            {plan.cook && (
                              <p className="text-sm text-gray-500 dark:text-gray-400">
                                Cook: {plan.cook}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-4 sm:gap-2">
                            <Link
                              to={`/meals/plan/${plan.id}/edit`}
                              className="px-3 py-2 min-h-[44px] flex items-center text-sm text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              Edit
                            </Link>
                            <button
                              onClick={() => handleDelete(plan.id, plan.title)}
                              className="px-3 py-2 min-h-[44px] flex items-center text-sm text-red-600 dark:text-red-400 hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </div>

                        {/* Dishes */}
                        {plan.dishIds.length > 0 && (
                          <div className="mt-2">
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Dishes:</p>
                            <ul className="space-y-1">
                              {plan.dishIds.map((dishId) => {
                                const dish = getDish(dishId)
                                return (
                                  <li key={dishId} className="text-sm">
                                    {dish ? (
                                      <Link
                                        to={`/dishes/${dishId}`}
                                        className="text-blue-600 dark:text-blue-400 hover:underline py-1 inline-block"
                                      >
                                        {dish.name}
                                      </Link>
                                    ) : (
                                      <span className="text-gray-400 italic">
                                        Unknown dish
                                      </span>
                                    )}
                                  </li>
                                )
                              })}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Delete Meal Plan"
        message={`Delete "${deleteTarget?.title}"?`}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
