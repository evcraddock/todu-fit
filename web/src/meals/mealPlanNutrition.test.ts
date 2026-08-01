import assert from 'node:assert/strict'
import test from 'node:test'
import { Dish } from '../dishes'
import { MealPlan } from './types'
import {
  calculateDailyPlanNutrition,
  calculateDishNutrition,
  calculateMealPlanNutrition,
} from './mealPlanNutrition'

function dish(id: string, nutrients: Dish['nutrients']): Dish {
  return {
    id,
    name: id,
    instructions: '',
    tags: [],
    ingredients: [],
    nutrients,
    createdAt: '',
    updatedAt: '',
  }
}

function plan(id: string, dishIds: string[]): MealPlan {
  return {
    id,
    date: '2026-08-01',
    mealType: 'dinner',
    title: id,
    cook: '',
    dishIds,
    usesLeftovers: false,
    createdAt: '',
    updatedAt: '',
  }
}

const completeDish = dish('complete', [
  { name: 'Calories', amount: 400, unit: 'kcal' },
  { name: 'Protein', amount: 20, unit: 'g' },
  { name: 'Carbohydrates', amount: 50, unit: 'g' },
  { name: 'Fat', amount: 10, unit: 'g' },
])

test('returns all available nutrients for a complete dish', () => {
  assert.deepEqual(calculateDishNutrition(completeDish), {
    calories: 400,
    protein: 20,
    carbs: 50,
    fat: 10,
  })
})

test('returns only nutrients available on an incomplete dish', () => {
  const incompleteDish = dish('incomplete', [
    { name: 'kcal', amount: 250, unit: 'kcal' },
    { name: 'Protein', amount: 12, unit: 'g' },
  ])

  assert.deepEqual(calculateDishNutrition(incompleteDish), {
    calories: 250,
    protein: 12,
  })
})

test('aggregates nutrients across dishes and meal plans', () => {
  const secondDish = dish('second', [
    { name: 'Calories', amount: 100, unit: 'kcal' },
    { name: 'Fat', amount: 5, unit: 'g' },
  ])
  const dishes = new Map([
    [completeDish.id, completeDish],
    [secondDish.id, secondDish],
  ])
  const getDish = (id: string) => dishes.get(id)

  assert.deepEqual(
    calculateMealPlanNutrition(plan('dinner', ['complete', 'second']), getDish),
    { calories: 500, protein: 20, carbs: 50, fat: 15 },
  )
  assert.deepEqual(
    calculateDailyPlanNutrition(
      [plan('dinner', ['complete']), plan('snack', ['second'])],
      getDish,
    ),
    { calories: 500, protein: 20, carbs: 50, fat: 15 },
  )
})

test('filters unsupported and invalid nutrient data', () => {
  const filteredDish = dish('filtered', [
    { name: 'Fiber', amount: 8, unit: 'g' },
    { name: 'Calories', amount: Number.NaN, unit: 'kcal' },
    { name: 'Protein', amount: Number.POSITIVE_INFINITY, unit: 'g' },
    { name: 'Fat', amount: -5, unit: 'g' },
    { name: 'Carbs', amount: 30, unit: 'g' },
  ])

  assert.deepEqual(calculateDishNutrition(filteredDish), { carbs: 30 })
  assert.deepEqual(
    calculateMealPlanNutrition(plan('filtered', ['filtered', 'missing']), (id) =>
      id === 'filtered' ? filteredDish : undefined,
    ),
    { calories: 0, protein: 0, carbs: 30, fat: 0 },
  )
})
