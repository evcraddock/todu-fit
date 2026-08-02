import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidIanaTimezone, resolveIanaTimezone } from './waterHistory'

test('legacy hydration settings receive a valid detected timezone', () => {
  assert.equal(isValidIanaTimezone(resolveIanaTimezone('')), true)
})

test('preserves an existing synced IANA timezone', () => {
  assert.equal(resolveIanaTimezone('America/Chicago'), 'America/Chicago')
})
