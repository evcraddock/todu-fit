import * as Automerge from '@automerge/automerge'
import assert from 'node:assert/strict'
import test from 'node:test'
import { getMealLogEntries } from './mealLogDocument'

const legacyLog = {
  id: 'legacy-log-id',
  date: '2026-01-15',
  meal_type: 'lunch',
  mealplan_id: null,
  dishes: ['dish-id'],
  dish_portions: { 'dish-id': 0.5 },
  notes: 'Legacy lunch',
  created_by: 'user-id',
  created_at: '2026-01-15T18:00:00Z',
}

test('accepts an empty legacy mealLogs list', () => {
  const doc = Automerge.from({ mealLogs: [] as typeof legacyLog[] })

  assert.deepEqual(getMealLogEntries(doc), [])
})

test('reads entries from a populated legacy mealLogs list without altering fields', () => {
  const doc = Automerge.from({ mealLogs: [legacyLog] })
  const entries = getMealLogEntries(doc)

  assert.deepEqual(entries, [['legacy-log-id', legacyLog]])
})

test('reads the current root-level map shape unchanged', () => {
  const { id: _id, ...currentLog } = legacyLog

  const doc = Automerge.from({ 'current-log-id': currentLog })

  assert.deepEqual(getMealLogEntries(doc), [['current-log-id', currentLog]])
})

test('prefers a current map entry when a legacy entry has the same id', () => {
  const { id: _id, ...legacyFields } = legacyLog
  const currentLog = { ...legacyFields, notes: 'Current entry' }

  assert.deepEqual(
    getMealLogEntries({
      'legacy-log-id': currentLog,
      mealLogs: [legacyLog],
    }),
    [['legacy-log-id', currentLog]],
  )
})
