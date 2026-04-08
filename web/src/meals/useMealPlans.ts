import * as Automerge from '@automerge/automerge'
import { useMemo, useState, useEffect } from 'react'
import { useDocument } from '../repo'
import { useRepoState } from '../repo/RepoContext'
import { MealPlan, MealPlansDoc, CliMealPlan, MealType } from './types'

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

// Convert CLI mealplan (snake_case) to web mealplan (camelCase)
function convertCliMealPlan(id: string, cliPlan: CliMealPlan): MealPlan {
  return {
    id,
    date: getString(cliPlan.date),
    mealType: getString(cliPlan.meal_type) as MealType,
    title: getString(cliPlan.title),
    cook: getString(cliPlan.cook),
    dishIds: (cliPlan.dish_ids ?? []).map((d) => getString(d)),
    usesLeftovers: cliPlan.uses_leftovers ?? false,
    createdAt: getString(cliPlan.created_at),
    updatedAt: getString(cliPlan.updated_at),
  }
}

export function useMealPlans() {
  const { docUrls } = useRepoState()
  const [doc, changeDoc] = useDocument<MealPlansDoc>(docUrls?.mealPlans)

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

  // Convert CLI format to web format, filtering invalid entries
  const isValidMealPlan = (entry: unknown): entry is CliMealPlan => {
    if (entry === null || typeof entry !== 'object') {
      return false
    }
    const plan = entry as Record<string, unknown>
    // Valid mealplan must have date and meal_type
    return 'date' in plan && 'meal_type' in plan
  }

  const mealPlans = useMemo(() => {
    if (!doc) return []
    return Object.entries(doc)
      .filter(([, entry]) => isValidMealPlan(entry))
      .map(([id, cliPlan]) => convertCliMealPlan(id, cliPlan))
  }, [doc])

  const getMealPlan = (id: string): MealPlan | undefined => {
    const cliPlan = doc?.[id]
    return cliPlan && isValidMealPlan(cliPlan)
      ? convertCliMealPlan(id, cliPlan)
      : undefined
  }

  // Get plans for a specific date
  const getPlansForDate = (date: string): MealPlan[] => {
    return mealPlans
      .filter((plan) => plan.date === date)
      .sort((a, b) => {
        const order = ['breakfast', 'lunch', 'dinner', 'snack']
        return order.indexOf(a.mealType) - order.indexOf(b.mealType)
      })
  }

  // Get plans for a date range (inclusive)
  const getPlansForRange = (startDate: string, endDate: string): MealPlan[] => {
    return mealPlans
      .filter((plan) => plan.date >= startDate && plan.date <= endDate)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date)
        const order = ['breakfast', 'lunch', 'dinner', 'snack']
        return order.indexOf(a.mealType) - order.indexOf(b.mealType)
      })
  }

  const addMealPlan = (plan: MealPlan) => {
    changeDoc((d) => {
      // Convert web format to CLI format (snake_case)
      // Use ImmutableString for all string fields for automerge-rs compatibility
      d[plan.id] = {
        id: imm(plan.id),
        date: imm(plan.date),
        meal_type: imm(plan.mealType),
        title: imm(plan.title),
        cook: imm(plan.cook),
        dish_ids: plan.dishIds.map((id) => imm(id)),
        uses_leftovers: plan.usesLeftovers,
        created_at: imm(plan.createdAt),
        updated_at: imm(plan.updatedAt),
      } as unknown as CliMealPlan
    })
  }

  const updateMealPlan = (id: string, updates: Partial<MealPlan>) => {
    changeDoc((d) => {
      if (d[id]) {
        // Use ImmutableString for all string fields for automerge-rs compatibility
        if (updates.date !== undefined) d[id].date = imm(updates.date) as unknown as string
        if (updates.mealType !== undefined)
          d[id].meal_type = imm(updates.mealType) as unknown as MealType
        if (updates.title !== undefined) d[id].title = imm(updates.title) as unknown as string
        if (updates.cook !== undefined) d[id].cook = imm(updates.cook) as unknown as string
        if (updates.dishIds !== undefined)
          d[id].dish_ids = updates.dishIds.map((did) => imm(did)) as unknown as string[]
        if (updates.usesLeftovers !== undefined) d[id].uses_leftovers = updates.usesLeftovers
        d[id].updated_at = imm(new Date().toISOString()) as unknown as string
      }
    })
  }

  const deleteMealPlan = (id: string) => {
    changeDoc((d) => {
      delete d[id]
    })
  }

  // Add a dish to an existing meal plan
  const addDishToPlan = (planId: string, dishId: string) => {
    changeDoc((d) => {
      // Check if dish already exists (comparing ImmutableString values)
      const exists = d[planId]?.dish_ids.some((id) => getString(id) === dishId)
      if (d[planId] && !exists) {
        d[planId].dish_ids.push(imm(dishId) as unknown as string)
        d[planId].updated_at = imm(new Date().toISOString()) as unknown as string
      }
    })
  }

  // Remove a dish from a meal plan
  const removeDishFromPlan = (planId: string, dishId: string) => {
    changeDoc((d) => {
      if (d[planId]) {
        d[planId].dish_ids = d[planId].dish_ids.filter((id) => getString(id) !== dishId)
        d[planId].updated_at = imm(new Date().toISOString()) as unknown as string
      }
    })
  }

  return {
    mealPlans,
    getMealPlan,
    getPlansForDate,
    getPlansForRange,
    addMealPlan,
    updateMealPlan,
    deleteMealPlan,
    addDishToPlan,
    removeDishFromPlan,
    isLoading: !doc && !timedOut,
  }
}
