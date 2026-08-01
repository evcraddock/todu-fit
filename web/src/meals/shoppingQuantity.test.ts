import assert from 'node:assert/strict'
import test from 'node:test'
import { formatShoppingQuantities } from './shoppingQuantity'

test('totals decimal quantities without floating-point noise', () => {
  assert.equal(
    formatShoppingQuantities([
      { quantity: '0.1', unit: 'cup' },
      { quantity: '0.2', unit: 'cups' },
    ]),
    '0.3 cup',
  )
})

test('totals and reduces simple fractions', () => {
  assert.equal(
    formatShoppingQuantities([
      { quantity: '1/2', unit: 'cup' },
      { quantity: '1/4', unit: 'cups' },
    ]),
    '3/4 cup',
  )
})

test('totals mixed fractions with safe unit aliases', () => {
  assert.equal(
    formatShoppingQuantities([
      { quantity: '1 1/2', unit: 'tablespoons' },
      { quantity: '1/2', unit: 'tbsp' },
    ]),
    '2 tbsp',
  )
})

test('normalizes common singular, plural, and abbreviation aliases', () => {
  assert.equal(
    formatShoppingQuantities([
      { quantity: '1', unit: 'ounce' },
      { quantity: '2', unit: 'oz' },
      { quantity: '3', unit: 'ounces' },
    ]),
    '6 oz',
  )
})

test('pluralizes combined cup totals greater than one', () => {
  assert.equal(
    formatShoppingQuantities([
      { quantity: '1', unit: 'cup' },
      { quantity: '1/2', unit: 'cups' },
    ]),
    '1 1/2 cups',
  )
})

test('keeps incompatible units separate without converting', () => {
  assert.equal(
    formatShoppingQuantities([
      { quantity: '1', unit: 'cup' },
      { quantity: '2', unit: 'tbsp' },
    ]),
    '1 cup, 2 tbsp',
  )
})

test('preserves descriptive and unsupported quantities', () => {
  assert.equal(
    formatShoppingQuantities([
      { quantity: '2 large', unit: 'cans' },
      { quantity: 'several', unit: 'cups' },
      { quantity: 'to taste', unit: '' },
      { quantity: '1', unit: 'bunch' },
      { quantity: '2', unit: 'bunches' },
    ]),
    '2 large cans, several cups, to taste, 1 bunch, 2 bunches',
  )
})

test('normalizes whitespace and formats mixed numeric styles deterministically', () => {
  assert.equal(
    formatShoppingQuantities([
      { quantity: ' 0.25 ', unit: ' Cups ' },
      { quantity: ' 1 / 2 ', unit: 'cup' },
      { quantity: '.25', unit: 'CUP' },
    ]),
    '1 cup',
  )
})
