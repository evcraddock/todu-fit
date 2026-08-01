import * as Automerge from '@automerge/automerge'
import assert from 'node:assert/strict'
import test from 'node:test'
import { Dish } from '../dishes'
import { MealLog } from './types'
import {
  calculateMealLogNutrition,
  getDishPortion,
  normalizeDishPortions,
  readDishPortions,
} from './mealLogPortions'

const dish: Dish = {
  id: 'dish-id',
  name: 'Test dish',
  instructions: '',
  tags: [],
  ingredients: [],
  nutrients: [
    { name: 'Calories', amount: 400, unit: 'kcal' },
    { name: 'Protein', amount: 20, unit: 'g' },
    { name: 'Carbohydrates', amount: 50, unit: 'g' },
    { name: 'Fat', amount: 10, unit: 'g' },
  ],
  createdAt: '',
  updatedAt: '',
}

function mealLog(dishPortions: Record<string, number>): MealLog {
  return {
    id: 'log-id',
    date: '2026-08-01',
    mealType: 'dinner',
    mealPlanId: null,
    dishIds: [dish.id],
    dishPortions,
    notes: '',
    createdBy: 'user-id',
    createdAt: '2026-08-01T18:00:00Z',
  }
}

test('scales nutrition for a fractional serving', () => {
  assert.deepEqual(
    calculateMealLogNutrition(mealLog({ [dish.id]: 0.5 }), () => dish),
    { calories: 200, protein: 10, carbs: 25, fat: 5 },
  )
})

test('scales nutrition for multiple servings', () => {
  assert.deepEqual(
    calculateMealLogNutrition(mealLog({ [dish.id]: 2 }), () => dish),
    { calories: 800, protein: 40, carbs: 100, fat: 20 },
  )
})

test('treats a legacy log without portion metadata as one serving', () => {
  assert.equal(getDishPortion({}, dish.id), 1)
  assert.deepEqual(
    calculateMealLogNutrition(mealLog({}), () => dish),
    { calories: 400, protein: 20, carbs: 50, fat: 10 },
  )
})

test('persists fractional and multiple servings in the shared schema', () => {
  const portions = normalizeDishPortions(['fractional', 'multiple'], {
    fractional: 0.25,
    multiple: 3,
    removed: 4,
  })
  const doc = Automerge.from({ dish_portions: portions })

  assert.deepEqual(readDishPortions(doc.dish_portions), {
    fractional: 0.25,
    multiple: 3,
  })
})

test('reads only positive numeric portions from the shared schema', () => {
  assert.deepEqual(
    readDishPortions({ valid: 1.5, zero: 0, negative: -1, text: '2' }),
    { valid: 1.5 },
  )
})
