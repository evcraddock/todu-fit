import * as Automerge from '@automerge/automerge'
import { useMemo, useState, useEffect, useCallback } from 'react'
import { useDocument } from '../repo'
import { useRepoState } from '../repo/RepoContext'
import { useDishes } from '../dishes/useDishes'
import { MealLog, MealLogsDoc, CliMealLog, MealType, NutritionSummary } from './types'
import { getMealLogEntries } from './mealLogDocument'
import { decodeMealLogDishes } from './mealLogDishes'
import {
  calculateMealLogNutrition,
  normalizeDishPortions,
  readDishPortions,
} from './mealLogPortions'

// Helper to create ImmutableString for non-collaborative text
// This ensures strings are stored as scalar values (compatible with automerge-rs)
function imm(value: string): Automerge.ImmutableString {
  return new Automerge.ImmutableString(value)
}

// Helper to extract string value from automerge strings
// Handles compatibility between automerge-rs and automerge-js string formats
function getString(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object' && 'val' in value) {
    return String((value as { val: unknown }).val)
  }
  if (value && typeof value === 'object' && 'toString' in value) {
    return String(value)
  }
  return ''
}

// Convert CLI meallog (snake_case) to web meallog (camelCase)
function convertCliMealLog(id: string, cliLog: CliMealLog): MealLog {
  const { dishIds, dishSnapshots } = decodeMealLogDishes(cliLog.dishes)
  return {
    id,
    date: getString(cliLog.date),
    mealType: getString(cliLog.meal_type) as MealType,
    mealPlanId: cliLog.mealplan_id ? getString(cliLog.mealplan_id) : null,
    dishIds,
    dishSnapshots,
    dishPortions: readDishPortions(cliLog.dish_portions),
    notes: getString(cliLog.notes ?? ''),
    createdBy: getString(cliLog.created_by),
    createdAt: getString(cliLog.created_at),
  }
}

export function useMealLogs() {
  const { docUrls } = useRepoState()
  // Meal logs are user-owned (private), not group-owned
  const [doc, changeDoc] = useDocument<MealLogsDoc>(docUrls?.mealLogs)
  const { getDish } = useDishes()

  // Track if we've waited long enough for doc to load
  // If doc doesn't exist on server, useDocument returns undefined forever
  // After timeout, we treat undefined as "empty document" not "loading"
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (doc) {
      setTimedOut(false)
      return
    }

    const timer = setTimeout(() => {
      setTimedOut(true)
    }, 2000)

    return () => clearTimeout(timer)
  }, [doc])

  const mealLogEntries = useMemo(() => doc ? getMealLogEntries(doc) : [], [doc])

  const mealLogs = useMemo(
    () => mealLogEntries.map(([id, cliLog]) => convertCliMealLog(id, cliLog)),
    [mealLogEntries],
  )

  const getMealLog = useCallback((id: string): MealLog | undefined => {
    const entry = mealLogEntries.find(([entryId]) => entryId === id)
    return entry ? convertCliMealLog(...entry) : undefined
  }, [mealLogEntries])

  // Get logs for a specific date
  const getLogsForDate = useCallback((date: string): MealLog[] => {
    return mealLogs
      .filter((log) => log.date === date)
      .sort((a, b) => {
        const order = ['breakfast', 'lunch', 'dinner', 'snack']
        return order.indexOf(a.mealType) - order.indexOf(b.mealType)
      })
  }, [mealLogs])

  // Get logs for a date range (inclusive)
  const getLogsForRange = useCallback((startDate: string, endDate: string): MealLog[] => {
    return mealLogs
      .filter((log) => log.date >= startDate && log.date <= endDate)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date)
        const order = ['breakfast', 'lunch', 'dinner', 'snack']
        return order.indexOf(a.mealType) - order.indexOf(b.mealType)
      })
  }, [mealLogs])

  // Calculate daily nutrition summary from logged dishes
  const getDailySummary = useCallback((date: string): NutritionSummary => {
    const logs = getLogsForDate(date)
    const summary: NutritionSummary = {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    }

    for (const log of logs) {
      const logSummary = calculateMealLogNutrition(log, getDish)
      summary.calories += logSummary.calories
      summary.protein += logSummary.protein
      summary.carbs += logSummary.carbs
      summary.fat += logSummary.fat
    }

    return summary
  }, [getLogsForDate, getDish])

  // Calculate nutrition for a single meal log
  const getLogNutrition = useCallback(
    (log: MealLog): NutritionSummary => calculateMealLogNutrition(log, getDish),
    [getDish],
  )

  const addMealLog = useCallback((log: MealLog) => {
    changeDoc((d) => {
      // Convert web format to CLI format (snake_case)
      // Use ImmutableString for all string fields for automerge-rs compatibility
      d[log.id] = {
        date: imm(log.date),
        meal_type: imm(log.mealType),
        mealplan_id: log.mealPlanId ? imm(log.mealPlanId) : null,
        dishes: log.dishIds.map((id) => imm(id)),
        dish_portions: normalizeDishPortions(log.dishIds, log.dishPortions),
        notes: log.notes ? imm(log.notes) : null,
        created_by: imm(log.createdBy),
        created_at: imm(log.createdAt),
      } as unknown as CliMealLog
    })
  }, [changeDoc])

  const updateMealLog = useCallback((id: string, updates: Partial<MealLog>) => {
    changeDoc((d) => {
      if (d[id]) {
        // Use ImmutableString for all string fields for automerge-rs compatibility
        if (updates.date !== undefined) d[id].date = imm(updates.date) as unknown as string
        if (updates.mealType !== undefined)
          d[id].meal_type = imm(updates.mealType) as unknown as MealType
        if (updates.mealPlanId !== undefined)
          d[id].mealplan_id = updates.mealPlanId
            ? (imm(updates.mealPlanId) as unknown as string)
            : null
        if (updates.dishIds !== undefined)
          d[id].dishes = updates.dishIds.map((did) => imm(did)) as unknown as string[]
        if (updates.dishIds !== undefined || updates.dishPortions !== undefined) {
          const dishIds = updates.dishIds ?? d[id].dishes.map((did) => getString(did))
          const portions = updates.dishPortions ?? readDishPortions(d[id].dish_portions)
          d[id].dish_portions = normalizeDishPortions(dishIds, portions)
        }
        if (updates.notes !== undefined)
          d[id].notes = updates.notes ? (imm(updates.notes) as unknown as string) : null
      }
    })
  }, [changeDoc])

  const deleteMealLog = useCallback((id: string) => {
    changeDoc((d) => {
      delete d[id]
    })
  }, [changeDoc])

  // Add a dish to an existing meal log
  const addDishToLog = useCallback((logId: string, dishId: string) => {
    changeDoc((d) => {
      // Check if dish already exists (comparing ImmutableString values)
      const exists = d[logId]?.dishes.some((id) => getString(id) === dishId)
      if (d[logId] && !exists) {
        d[logId].dishes.push(imm(dishId) as unknown as string)
        d[logId].dish_portions = {
          ...readDishPortions(d[logId].dish_portions),
          [dishId]: 1,
        }
      }
    })
  }, [changeDoc])

  // Remove a dish from a meal log
  const removeDishFromLog = useCallback((logId: string, dishId: string) => {
    changeDoc((d) => {
      if (d[logId]) {
        d[logId].dishes = d[logId].dishes.filter((id) => getString(id) !== dishId)
        const portions = readDishPortions(d[logId].dish_portions)
        delete portions[dishId]
        d[logId].dish_portions = portions
      }
    })
  }, [changeDoc])

  return {
    mealLogs,
    getMealLog,
    getLogsForDate,
    getLogsForRange,
    getDailySummary,
    getLogNutrition,
    addMealLog,
    updateMealLog,
    deleteMealLog,
    addDishToLog,
    removeDishFromLog,
    isLoading: !doc && !timedOut,
  }
}
