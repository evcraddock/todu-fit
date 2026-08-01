import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useRepoState, RepoLoading } from '../repo'
import { useMealLogs } from './useMealLogs'
import { useDishes } from '../dishes/useDishes'
import { MEAL_TYPES, MEAL_TYPE_COLORS, MEAL_TYPE_LABELS, MealType, MealLog } from './types'
import { ConfirmDialog } from '../components'
import { getDishPortion } from './mealLogPortions'
import { resolveMealLogDish } from './mealLogDishes'

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

function getTodayDate(): string {
  return formatDate(new Date())
}

export function MealLogList() {
  const { isReady } = useRepoState()

  if (!isReady) {
    return <RepoLoading />
  }

  return <MealLogListContent />
}

function MealLogListContent() {
  const { date } = useParams<{ date: string }>()
  const { getLogsForDate, getDailySummary, getLogNutrition, deleteMealLog, isLoading: logsLoading } = useMealLogs()
  const { getDish, isLoading: dishesLoading } = useDishes()
  const [deleteLogId, setDeleteLogId] = useState<string | null>(null)

  const isLoading = logsLoading || dishesLoading

  // Parse the date (default to today)
  const dateStr = date || getTodayDate()
  const currentDate = useMemo(() => parseDate(dateStr), [dateStr])
  const prevDate = formatDate(addDays(currentDate, -1))
  const nextDate = formatDate(addDays(currentDate, 1))

  // Get logs for this date
  const logs = useMemo(() => getLogsForDate(dateStr), [getLogsForDate, dateStr])

  // Get daily nutrition summary
  const dailySummary = useMemo(() => getDailySummary(dateStr), [getDailySummary, dateStr])

  // Group logs by meal type
  const logsByMealType = useMemo(() => {
    const grouped: Record<MealType, MealLog[]> = {
      breakfast: [],
      lunch: [],
      dinner: [],
      snack: [],
    }
    for (const log of logs) {
      grouped[log.mealType].push(log)
    }
    return grouped
  }, [logs])

  // Format date for display
  const displayDate = currentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const handleDelete = (logId: string) => {
    setDeleteLogId(logId)
  }

  const confirmDelete = () => {
    if (deleteLogId) {
      deleteMealLog(deleteLogId)
      setDeleteLogId(null)
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
            to={`/log/${prevDate}`}
            className="px-3 sm:px-4 py-3 min-h-[44px] bg-gray-600 dark:bg-gray-700 text-white rounded-lg hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
          >
            ←
          </Link>
          <h1 className="text-base sm:text-xl font-semibold text-gray-900 dark:text-gray-100 text-center px-2">{displayDate}</h1>
          <Link
            to={`/log/${nextDate}`}
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
            Plans
          </Link>
          <Link
            to={`/log/new?date=${dateStr}`}
            className="flex-1 sm:flex-none px-4 py-3 min-h-[44px] bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors text-center"
          >
            + Log Meal
          </Link>
        </div>
      </div>

      {/* Daily Summary */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6 transition-colors">
        <h2 className="text-lg font-medium mb-3 text-gray-900 dark:text-gray-100">Daily Summary</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400">{Math.round(dailySummary.calories)}</div>
            <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">Calories</div>
          </div>
          <div>
            <div className="text-xl sm:text-2xl font-bold text-green-600 dark:text-green-400">{Math.round(dailySummary.protein)}g</div>
            <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">Protein</div>
          </div>
          <div>
            <div className="text-xl sm:text-2xl font-bold text-amber-600 dark:text-amber-400">{Math.round(dailySummary.carbs)}g</div>
            <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">Carbs</div>
          </div>
          <div>
            <div className="text-xl sm:text-2xl font-bold text-red-600 dark:text-red-400">{Math.round(dailySummary.fat)}g</div>
            <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">Fat</div>
          </div>
        </div>
      </div>

      {/* Meal Sections */}
      <div className="space-y-6">
        {MEAL_TYPES.map((mealType) => {
          const typeLogs = logsByMealType[mealType]

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
                  to={`/log/new?date=${dateStr}&type=${mealType}`}
                  className="px-3 py-2 min-h-[44px] flex items-center text-sm text-green-600 dark:text-green-400 hover:underline"
                >
                  + Log
                </Link>
              </div>

              {/* Logs */}
              <div className="p-4">
                {typeLogs.length === 0 ? (
                  <p className="text-gray-400 text-sm italic">No meals logged</p>
                ) : (
                  <div className="space-y-4">
                    {typeLogs.map((log) => {
                      const nutrition = getLogNutrition(log)
                      return (
                        <div
                          key={log.id}
                          className="border border-gray-200 dark:border-gray-700 rounded p-3"
                        >
                          <div className="flex flex-col sm:flex-row justify-between items-start gap-2 mb-2">
                            <div className="flex-1">
                              {/* Dishes */}
                              {log.dishIds.length > 0 ? (
                                <ul className="space-y-1">
                                  {log.dishIds.map((dishId) => {
                                    const sharedDish = getDish(dishId)
                                    const dish = resolveMealLogDish(log, dishId, getDish)
                                    const portion = getDishPortion(log.dishPortions, dishId)
                                    return (
                                      <li key={dishId} className="text-sm flex items-center gap-2">
                                        {dish && sharedDish ? (
                                          <Link
                                            to={`/dishes/${dishId}`}
                                            className="text-blue-600 dark:text-blue-400 hover:underline font-medium py-1 inline-block"
                                          >
                                            {dish.name}
                                          </Link>
                                        ) : dish ? (
                                          <span className="font-medium">{dish.name}</span>
                                        ) : (
                                          <span className="text-gray-400 italic">
                                            Unknown dish
                                          </span>
                                        )}
                                        <span className="text-gray-500 dark:text-gray-400">
                                          {portion} {portion === 1 ? 'serving' : 'servings'}
                                        </span>
                                      </li>
                                    )
                                  })}
                                </ul>
                              ) : (
                                <p className="text-gray-400 text-sm italic">No dishes</p>
                              )}
                              {/* Notes */}
                              {log.notes && (
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                  {log.notes}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-4 sm:gap-2 sm:ml-4">
                              <Link
                                to={`/log/${log.id}/edit`}
                                className="px-3 py-2 min-h-[44px] flex items-center text-sm text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                Edit
                              </Link>
                              <button
                                onClick={() => handleDelete(log.id)}
                                className="px-3 py-2 min-h-[44px] flex items-center text-sm text-red-600 dark:text-red-400 hover:underline"
                              >
                                Delete
                              </button>
                            </div>
                          </div>

                          {/* Nutrition for this log */}
                          {log.dishIds.length > 0 && (
                            <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                              <span>{Math.round(nutrition.calories)} cal</span>
                              <span>{Math.round(nutrition.protein)}g protein</span>
                              <span>{Math.round(nutrition.carbs)}g carbs</span>
                              <span>{Math.round(nutrition.fat)}g fat</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        isOpen={deleteLogId !== null}
        title="Delete Meal Log"
        message="Are you sure you want to delete this meal log?"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteLogId(null)}
      />
    </div>
  )
}
