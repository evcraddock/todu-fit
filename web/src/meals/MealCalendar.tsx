import { useState, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useRepoState, RepoLoading } from '../repo'
import { useMealPlans } from './useMealPlans'
import { Dish } from '../dishes'
import { useDishes } from '../dishes/useDishes'
import { MEAL_TYPE_COLORS, MEAL_TYPE_LABELS, MealType, MEAL_TYPES, MealPlan } from './types'
import { ShoppingCart } from './ShoppingCart'
import { NutritionInline } from './NutritionInline'
import { calculateDishNutrition } from './mealPlanNutrition'

type TabType = 'meals' | 'shopping'

// Date utilities
function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function getWeekStart(date: Date): Date {
  const result = new Date(date)
  const day = result.getDay()
  result.setDate(result.getDate() - day)
  return result
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function MealCalendar() {
  const { isReady } = useRepoState()

  if (!isReady) {
    return <RepoLoading />
  }

  return <MealCalendarContent />
}

function MealCalendarContent() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { getPlansForRange, isLoading } = useMealPlans()
  const { getDish } = useDishes()
  const [activeTab, setActiveTab] = useState<TabType>('meals')

  // Get date from URL or default to today
  const dateParam = searchParams.get('date')
  const [currentDate, setCurrentDate] = useState(() => {
    if (dateParam) {
      return parseDate(dateParam)
    }
    return new Date()
  })

  // Calculate week range
  const weekStart = useMemo(() => getWeekStart(currentDate), [currentDate])
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart])

  // Get plans for the week
  const weekPlans = useMemo(() => {
    return getPlansForRange(formatDate(weekStart), formatDate(weekEnd))
  }, [getPlansForRange, weekStart, weekEnd])

  // Group plans by date
  const plansByDate = useMemo(() => {
    const grouped: Record<string, { mealType: MealType; count: number }[]> = {}
    for (const plan of weekPlans) {
      if (!grouped[plan.date]) {
        grouped[plan.date] = []
      }
      grouped[plan.date].push({ mealType: plan.mealType, count: plan.dishIds.length })
    }
    return grouped
  }, [weekPlans])

  // Generate days for the week
  const days = useMemo(() => {
    const result = []
    for (let i = 0; i < 7; i++) {
      const date = addDays(weekStart, i)
      const dateStr = formatDate(date)
      result.push({
        date,
        dateStr,
        isToday: isSameDay(date, new Date()),
        plans: plansByDate[dateStr] || [],
      })
    }
    return result
  }, [weekStart, plansByDate])

  const navigateWeek = (direction: -1 | 1) => {
    const newDate = addDays(currentDate, direction * 7)
    setCurrentDate(newDate)
    setSearchParams({ date: formatDate(newDate) })
  }

  const goToToday = () => {
    const today = new Date()
    setCurrentDate(today)
    setSearchParams({ date: formatDate(today) })
  }

  // Format header date range
  const headerText = useMemo(() => {
    const startMonth = weekStart.toLocaleDateString('en-US', { month: 'short' })
    const endMonth = weekEnd.toLocaleDateString('en-US', { month: 'short' })
    const year = weekEnd.getFullYear()

    if (startMonth === endMonth) {
      return `${startMonth} ${weekStart.getDate()} - ${weekEnd.getDate()}, ${year}`
    }
    return `${startMonth} ${weekStart.getDate()} - ${endMonth} ${weekEnd.getDate()}, ${year}`
  }, [weekStart, weekEnd])

  if (isLoading) {
    return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 mb-6">
        {/* Week Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigateWeek(-1)}
            className="px-3 sm:px-4 py-3 min-h-[44px] bg-gray-600 dark:bg-gray-700 text-white rounded-lg hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
          >
            ←
          </button>
          <h1 className="text-base sm:text-xl font-semibold text-center text-gray-900 dark:text-gray-100 px-2">
            {headerText}
          </h1>
          <button
            onClick={() => navigateWeek(1)}
            className="px-3 sm:px-4 py-3 min-h-[44px] bg-gray-600 dark:bg-gray-700 text-white rounded-lg hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
          >
            →
          </button>
        </div>
        <button
          onClick={goToToday}
          className="px-4 py-3 min-h-[44px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors w-full sm:w-auto sm:self-center"
        >
          Today
        </button>
      </div>

      {/* Calendar Grid - Hidden on mobile, shown on sm+ */}
      <div className="hidden sm:grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        {/* Day Headers */}
        {DAY_NAMES.map((name) => (
          <div
            key={name}
            className="bg-gray-100 dark:bg-gray-800 p-3 text-center font-semibold text-gray-600 dark:text-gray-400 text-sm"
          >
            {name}
          </div>
        ))}

        {/* Day Cells */}
        {days.map((day) => (
          <Link
            key={day.dateStr}
            to={`/meals/${day.dateStr}`}
            className={`bg-white dark:bg-gray-800 min-h-[100px] lg:min-h-[120px] p-2 lg:p-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
              day.isToday ? 'bg-blue-50 dark:bg-blue-900/30' : ''
            }`}
          >
            <span
              className={`font-medium ${
                day.isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'
              }`}
            >
              {day.date.getDate()}
            </span>
            {day.plans.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-2">
                {day.plans.slice(0, 4).map((plan, idx) => (
                  <span
                    key={idx}
                    className={`w-3 h-3 rounded-full ${MEAL_TYPE_COLORS[plan.mealType]}`}
                    title={MEAL_TYPE_LABELS[plan.mealType]}
                  />
                ))}
                {day.plans.length > 4 && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    +{day.plans.length - 4}
                  </span>
                )}
              </div>
            )}
          </Link>
        ))}
      </div>

      {/* Mobile Day List - shown only on mobile */}
      <div className="sm:hidden space-y-2">
        {days.map((day) => (
          <Link
            key={day.dateStr}
            to={`/meals/${day.dateStr}`}
            className={`flex items-center justify-between p-4 min-h-[56px] bg-white dark:bg-gray-800 rounded-lg shadow-sm active:bg-gray-50 dark:active:bg-gray-700 ${
              day.isToday ? 'ring-2 ring-blue-500' : ''
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`font-medium ${
                  day.isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'
                }`}
              >
                {DAY_NAMES[day.date.getDay()]} {day.date.getDate()}
              </span>
              {day.isToday && (
                <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded">
                  Today
                </span>
              )}
            </div>
            {day.plans.length > 0 && (
              <div className="flex gap-1">
                {day.plans.slice(0, 4).map((plan, idx) => (
                  <span
                    key={idx}
                    className={`w-3 h-3 rounded-full ${MEAL_TYPE_COLORS[plan.mealType]}`}
                  />
                ))}
                {day.plans.length > 4 && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                    +{day.plans.length - 4}
                  </span>
                )}
              </div>
            )}
          </Link>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 sm:gap-6 mt-4 justify-center text-sm text-gray-600 dark:text-gray-400">
        {(['breakfast', 'lunch', 'dinner', 'snack'] as MealType[]).map((type) => (
          <span key={type} className="flex items-center gap-1.5 sm:gap-2">
            <span className={`w-3 h-3 rounded-full ${MEAL_TYPE_COLORS[type]}`} />
            <span className="text-xs sm:text-sm">{MEAL_TYPE_LABELS[type]}</span>
          </span>
        ))}
      </div>

      {/* Tabs */}
      <div className="mt-6">
        {/* Tab Bar */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab('meals')}
            className={`flex-1 sm:flex-none px-4 sm:px-6 py-3 min-h-[44px] text-sm font-medium transition-colors ${
              activeTab === 'meals'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Weekly Meals
          </button>
          <button
            onClick={() => setActiveTab('shopping')}
            className={`flex-1 sm:flex-none px-4 sm:px-6 py-3 min-h-[44px] text-sm font-medium transition-colors ${
              activeTab === 'shopping'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Shopping Cart
          </button>
        </div>

        {/* Tab Content */}
        <div className="mt-4">
          {activeTab === 'meals' ? (
            <WeeklyMealsTab weekPlans={weekPlans} getDish={getDish} />
          ) : (
            <ShoppingCart weekStart={formatDate(weekStart)} weekEnd={formatDate(weekEnd)} />
          )}
        </div>
      </div>
    </div>
  )
}

// Weekly Meals Tab Component
interface WeeklyMealsTabProps {
  weekPlans: MealPlan[]
  getDish: (id: string) => Dish | undefined
}

function WeeklyMealsTab({ weekPlans, getDish }: WeeklyMealsTabProps) {
  // Group plans by date, then by meal type
  const plansByDate = useMemo(() => {
    const grouped: Record<string, Record<MealType, MealPlan[]>> = {}
    
    for (const plan of weekPlans) {
      if (!grouped[plan.date]) {
        grouped[plan.date] = {} as Record<MealType, MealPlan[]>
      }
      if (!grouped[plan.date][plan.mealType]) {
        grouped[plan.date][plan.mealType] = []
      }
      grouped[plan.date][plan.mealType].push(plan)
    }
    
    return grouped
  }, [weekPlans])

  // Get sorted dates that have plans
  const datesWithPlans = useMemo(() => {
    return Object.keys(plansByDate).sort()
  }, [plansByDate])

  // Format date for display
  const formatDisplayDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'short', 
      day: 'numeric' 
    })
  }

  if (datesWithPlans.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
        <p className="text-gray-500 dark:text-gray-400">No meals planned this week</p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
          Click on a day in the calendar to add meal plans
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {datesWithPlans.map((dateStr) => (
        <div key={dateStr} className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          {/* Date Header */}
          <Link
            to={`/meals/${dateStr}`}
            className="block px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <h3 className="font-medium text-gray-900 dark:text-gray-100">
              {formatDisplayDate(dateStr)}
            </h3>
          </Link>

          {/* Meals for this day */}
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {MEAL_TYPES.map((mealType) => {
              const plans = plansByDate[dateStr][mealType]
              if (!plans || plans.length === 0) return null

              return (
                <div key={mealType} className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${MEAL_TYPE_COLORS[mealType]}`} />
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      {MEAL_TYPE_LABELS[mealType]}
                    </span>
                  </div>
                  <div className="ml-4 space-y-1">
                    {plans.map((plan) => (
                      <div key={plan.id}>
                        {plan.usesLeftovers && (
                          <div className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                            Leftovers
                          </div>
                        )}
                        {plan.dishIds.length > 0 ? (
                          <ul className="text-sm">
                            {plan.dishIds.map((dishId) => {
                              const dish = getDish(dishId)
                              return (
                                <li key={dishId} className="flex flex-wrap items-baseline gap-x-2">
                                  <span className="text-gray-400">•</span>
                                  {dish ? (
                                    <>
                                      <Link
                                        to={`/dishes/${dishId}`}
                                        className="text-blue-600 dark:text-blue-400 hover:underline"
                                      >
                                        {dish.name}
                                      </Link>
                                      <NutritionInline nutrition={calculateDishNutrition(dish)} />
                                    </>
                                  ) : (
                                    <span className="text-gray-400 italic">Unknown dish</span>
                                  )}
                                </li>
                              )
                            })}
                          </ul>
                        ) : (
                          <span className="text-sm text-gray-400 dark:text-gray-500 italic">
                            No dishes
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
