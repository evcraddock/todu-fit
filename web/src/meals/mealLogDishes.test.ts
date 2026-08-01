import * as Automerge from '@automerge/automerge'
import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeMealLogDishes, resolveMealLogDish } from './mealLogDishes'
import { MealLog } from './types'

const snapshot = {
  id: 'snapshot-dish-id',
  name: 'iOS Dinner',
  instructions: 'Serve warm.',
  prep_time: 5,
  cook_time: 10,
  servings: 2,
  tags: ['dinner'],
  ingredients: [
    { name: 'rice', quantity: 1.5, unit: 'cups' },
  ],
  nutrients: [
    { name: 'calories', amount: 500, unit: 'kcal' },
    { name: 'protein', amount: 35, unit: 'g' },
  ],
  created_at: '2026-07-31T22:03:12Z',
  updated_at: '2026-07-31T22:03:12Z',
}

test('decodes UUID references without creating snapshots', () => {
  assert.deepEqual(decodeMealLogDishes(['dish-one', { val: 'dish-two' }]), {
    dishIds: ['dish-one', 'dish-two'],
    dishSnapshots: {},
  })
})

test('decodes an embedded iOS dish snapshot from an Automerge document', () => {
  const doc = Automerge.from({ dishes: [snapshot] })
  const result = decodeMealLogDishes(doc.dishes)

  assert.deepEqual(result.dishIds, ['snapshot-dish-id'])
  assert.deepEqual(result.dishSnapshots['snapshot-dish-id'], {
    id: 'snapshot-dish-id',
    name: 'iOS Dinner',
    instructions: 'Serve warm.',
    prepTime: 5,
    cookTime: 10,
    servings: 2,
    tags: ['dinner'],
    ingredients: [{ name: 'rice', quantity: '1.5', unit: 'cups' }],
    nutrients: [
      { name: 'calories', amount: 500, unit: 'kcal' },
      { name: 'protein', amount: 35, unit: 'g' },
    ],
    createdAt: '2026-07-31T22:03:12Z',
    updatedAt: '2026-07-31T22:03:12Z',
  })
})

test('skips malformed entries while retaining supported entries', () => {
  assert.deepEqual(decodeMealLogDishes([null, 42, {}, { id: 'missing-name' }, 'dish-id']), {
    dishIds: ['dish-id'],
    dishSnapshots: {},
  })
})

test('resolves a snapshot before consulting the shared dish collection', () => {
  const decoded = decodeMealLogDishes([snapshot])
  const log = {
    dishIds: decoded.dishIds,
    dishSnapshots: decoded.dishSnapshots,
  } as MealLog

  assert.equal(resolveMealLogDish(log, 'snapshot-dish-id', () => undefined)?.name, 'iOS Dinner')
})
