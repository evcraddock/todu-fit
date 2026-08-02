import assert from 'node:assert/strict'
import test from 'node:test'
import { WaterEntry } from './types'
import {
  buildWaterHistory,
  dateStringInTimezone,
  isValidIanaTimezone,
  shiftDateString,
} from './waterHistory'

function entry(id: string, consumedAt: string, amountMl: number): WaterEntry {
  return { id, consumedAt, amountMl, createdAt: consumedAt, updatedAt: consumedAt }
}

test('groups entries by the configured timezone across a UTC date boundary', () => {
  const entries = [
    entry('early', '2026-07-25T05:00:00Z', 250),
    entry('evening', '2026-07-26T03:20:18Z', 500),
    entry('next-day', '2026-07-26T05:00:00Z', 750),
  ]

  assert.deepEqual(buildWaterHistory(entries, '2026-07-25', '2026-07-25', 'America/Chicago'), [
    { date: '2026-07-25', entries: entries.slice(0, 2), totalMl: 750 },
  ])
})

test('keeps UTC behavior when UTC is explicitly configured', () => {
  const evening = entry('evening', '2026-07-26T03:20:18Z', 500)

  assert.deepEqual(buildWaterHistory([evening], '2026-07-25', '2026-07-26', 'UTC'), [
    { date: '2026-07-25', entries: [], totalMl: 0 },
    { date: '2026-07-26', entries: [evening], totalMl: 500 },
  ])
})

test('uses IANA daylight-saving rules', () => {
  assert.equal(dateStringInTimezone('2026-03-08T07:30:00Z', 'America/Chicago'), '2026-03-08')
  assert.equal(dateStringInTimezone('2026-03-08T08:30:00Z', 'America/Chicago'), '2026-03-08')
})

test('builds an inclusive date range with empty days', () => {
  assert.deepEqual(buildWaterHistory([], '2026-07-24', '2026-07-26', 'UTC').map((day) => day.date), [
    '2026-07-24',
    '2026-07-25',
    '2026-07-26',
  ])
})

test('validates IANA zones and shifts date-only values', () => {
  assert.equal(isValidIanaTimezone('America/Chicago'), true)
  assert.equal(isValidIanaTimezone('Central Time'), false)
  assert.equal(shiftDateString('2026-03-08', -6), '2026-03-02')
})
