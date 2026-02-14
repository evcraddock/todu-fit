import * as Automerge from '@automerge/automerge'
import { useMemo, useState, useEffect } from 'react'
import { useDocument } from '../repo'
import { useRepoState } from '../repo/RepoContext'
import { ShoppingCartsDoc, CliShoppingCart, ManualShoppingItem } from './types'

// Helper to create ImmutableString for non-collaborative text
function imm(value: string): Automerge.ImmutableString {
  return new Automerge.ImmutableString(value)
}

// Helper to extract string value from automerge strings
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

// Get the Sunday of the week containing the given date
export function getWeekStart(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const dayStr = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${dayStr}`
}

// Get week start from a date string (YYYY-MM-DD)
export function getWeekStartFromDateString(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  return getWeekStart(new Date(year, month - 1, day))
}

export function useShoppingCart(weekStart: string) {
  const { docUrls } = useRepoState()
  const [doc, changeDoc] = useDocument<ShoppingCartsDoc>(docUrls?.shoppingCarts)

  // Track loading state with timeout
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

  // Get the cart for this week, or empty defaults
  const cart = useMemo((): CliShoppingCart => {
    const weekCart = doc?.[weekStart]
    if (!weekCart) {
      return { checked: [], manual_items: [] }
    }
    return {
      checked: (weekCart.checked ?? []).map(getString),
      manual_items: (weekCart.manual_items ?? []).map((item) => ({
        name: getString(item.name),
        quantity: getString(item.quantity),
        unit: getString(item.unit),
      })),
    }
  }, [doc, weekStart])

  // Check if an item is checked (case-insensitive)
  const isChecked = (name: string): boolean => {
    return cart.checked.includes(name.toLowerCase())
  }

  // Toggle checked state for an item
  const toggleChecked = (name: string) => {
    const key = name.toLowerCase()
    changeDoc((d) => {
      // Initialize week if needed
      if (!d[weekStart]) {
        d[weekStart] = {
          checked: [],
          manual_items: [],
        } as unknown as CliShoppingCart
      }

      const cart = d[weekStart]
      const checkedList = cart.checked ?? []
      const index = checkedList.findIndex((item) => getString(item) === key)

      if (index >= 0) {
        // Uncheck - remove from array
        cart.checked.splice(index, 1)
      } else {
        // Check - add to array
        cart.checked.push(imm(key) as unknown as string)
      }
    })
  }

  // Add a manual item
  const addManualItem = (item: ManualShoppingItem) => {
    changeDoc((d) => {
      // Initialize week if needed
      if (!d[weekStart]) {
        d[weekStart] = {
          checked: [],
          manual_items: [],
        } as unknown as CliShoppingCart
      }

      const cart = d[weekStart]
      if (!cart.manual_items) {
        cart.manual_items = []
      }

      cart.manual_items.push({
        name: imm(item.name),
        quantity: imm(item.quantity),
        unit: imm(item.unit),
      } as unknown as ManualShoppingItem)
    })
  }

  // Update a manual item by original name (finds at mutation time to handle concurrent sync)
  const updateManualItem = (originalName: string, updated: ManualShoppingItem) => {
    const key = originalName.toLowerCase()
    changeDoc((d) => {
      if (!d[weekStart]) return

      const cart = d[weekStart]
      if (!cart.manual_items) return

      const index = cart.manual_items.findIndex(
        (item) => getString(item.name).toLowerCase() === key
      )
      if (index < 0) return

      cart.manual_items[index].name = imm(updated.name) as unknown as string
      cart.manual_items[index].quantity = imm(updated.quantity) as unknown as string
      cart.manual_items[index].unit = imm(updated.unit) as unknown as string

      // Update checked list if name changed
      const newName = updated.name.toLowerCase()
      if (key !== newName && cart.checked) {
        const checkedIndex = cart.checked.findIndex((item) => getString(item) === key)
        if (checkedIndex >= 0) {
          cart.checked[checkedIndex] = imm(newName) as unknown as string
        }
      }
    })
  }

  // Remove a manual item by name
  const removeManualItem = (name: string) => {
    const key = name.toLowerCase()
    changeDoc((d) => {
      if (!d[weekStart]) return

      const cart = d[weekStart]
      if (!cart.manual_items) return

      const index = cart.manual_items.findIndex(
        (item) => getString(item.name).toLowerCase() === key
      )
      if (index >= 0) {
        cart.manual_items.splice(index, 1)
      }

      // Also remove from checked if present
      const checkedIndex = cart.checked?.findIndex((item) => getString(item) === key)
      if (checkedIndex !== undefined && checkedIndex >= 0) {
        cart.checked.splice(checkedIndex, 1)
      }
    })
  }

  return {
    checkedItems: cart.checked,
    manualItems: cart.manual_items,
    isChecked,
    toggleChecked,
    addManualItem,
    updateManualItem,
    removeManualItem,
    isLoading: !doc && !timedOut,
  }
}
