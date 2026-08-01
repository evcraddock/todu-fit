import assert from 'node:assert/strict'
import test from 'node:test'
import { partitionShoppingItems } from './shoppingPresentation'

interface Item {
  name: string
  checked: boolean
}

const items: Item[] = [
  { name: 'Apples', checked: false },
  { name: 'Bread', checked: true },
  { name: 'Carrots', checked: false },
  { name: 'Dates', checked: true },
]

test('partitions unchecked items before checked items', () => {
  assert.deepEqual(partitionShoppingItems(items, (item) => item.checked), {
    unchecked: [items[0], items[2]],
    checked: [items[1], items[3]],
  })
})

test('preserves source order within each section', () => {
  const result = partitionShoppingItems(items, (item) => item.checked)

  assert.deepEqual(result.unchecked.map((item) => item.name), ['Apples', 'Carrots'])
  assert.deepEqual(result.checked.map((item) => item.name), ['Bread', 'Dates'])
})

test('handles lists with no checked items', () => {
  assert.deepEqual(
    partitionShoppingItems(items.slice(0, 1), (item) => item.checked),
    { unchecked: [items[0]], checked: [] },
  )
})

test('handles lists with no unchecked items', () => {
  assert.deepEqual(
    partitionShoppingItems(items.slice(1, 2), (item) => item.checked),
    { unchecked: [], checked: [items[1]] },
  )
})
