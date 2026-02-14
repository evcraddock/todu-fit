import { useState, useMemo } from 'react'
import { useShoppingCart } from './useShoppingCart'
import { useMealPlans } from './useMealPlans'
import { useDishes } from '../dishes/useDishes'
import { ManualShoppingItem } from './types'
import { EditItemDialog } from './EditItemDialog'

interface AggregatedIngredient {
  name: string
  quantities: { quantity: string; unit: string }[]
  isManual: boolean
  manualIndex: number | null  // index into manual_items array, null if dish-sourced
}

interface ShoppingCartProps {
  weekStart: string
  weekEnd: string
}

export function ShoppingCart({ weekStart, weekEnd }: ShoppingCartProps) {
  const { getPlansForRange } = useMealPlans()
  const { getDish } = useDishes()
  const {
    manualItems,
    isChecked,
    toggleChecked,
    addManualItem,
    updateManualItem,
    removeManualItem,
    isLoading,
  } = useShoppingCart(weekStart)

  // Form state for adding items
  const [newItemName, setNewItemName] = useState('')
  const [newItemQuantity, setNewItemQuantity] = useState('')
  const [newItemUnit, setNewItemUnit] = useState('')
  const [addItemError, setAddItemError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(true)
  const [editingItem, setEditingItem] = useState<{ index: number; item: ManualShoppingItem } | null>(null)

  // Get meal plans for this week
  const plans = useMemo(
    () => getPlansForRange(weekStart, weekEnd),
    [getPlansForRange, weekStart, weekEnd]
  )

  // Aggregate ingredients from meal plans + manual items
  const aggregatedIngredients = useMemo(() => {
    const ingredientMap = new Map<string, AggregatedIngredient>()

    // Add ingredients from meal plans
    for (const plan of plans) {
      for (const dishId of plan.dishIds) {
        const dish = getDish(dishId)
        if (!dish) continue

        for (const ing of dish.ingredients) {
          const key = ing.name.toLowerCase().trim()
          if (!ingredientMap.has(key)) {
            ingredientMap.set(key, {
              name: ing.name,
              quantities: [],
              isManual: false,
              manualIndex: null,
            })
          }
          const entry = ingredientMap.get(key)!
          if (ing.quantity || ing.unit) {
            entry.quantities.push({
              quantity: ing.quantity,
              unit: ing.unit,
            })
          }
        }
      }
    }

    // Add manual items
    for (let i = 0; i < manualItems.length; i++) {
      const item = manualItems[i]
      const key = item.name.toLowerCase().trim()
      if (!ingredientMap.has(key)) {
        ingredientMap.set(key, {
          name: item.name,
          quantities: [],
          isManual: true,
          manualIndex: i,
        })
      }
      const entry = ingredientMap.get(key)!
      if (item.quantity || item.unit) {
        entry.quantities.push({
          quantity: item.quantity,
          unit: item.unit,
        })
      }
      // Track manual index (only for manual-only items)
      if (entry.manualIndex === null) {
        entry.manualIndex = i
      }
    }

    // Sort alphabetically only (don't reorder when checked)
    return Array.from(ingredientMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [plans, getDish, manualItems])

  // Check if item is manual-only (not from meal plans)
  const isManualOnly = (name: string): boolean => {
    const key = name.toLowerCase()
    // Check if any meal plan dish has this ingredient
    for (const plan of plans) {
      for (const dishId of plan.dishIds) {
        const dish = getDish(dishId)
        if (dish?.ingredients.some((i) => i.name.toLowerCase() === key)) {
          return false
        }
      }
    }
    // Check if it's in manual items
    return manualItems.some((item) => item.name.toLowerCase() === key)
  }

  // Format quantities for display
  const formatQuantities = (quantities: { quantity: string; unit: string }[]): string => {
    if (quantities.length === 0) return ''

    const byUnit = new Map<string, string[]>()
    for (const q of quantities) {
      const unit = q.unit.toLowerCase().trim()
      if (!byUnit.has(unit)) {
        byUnit.set(unit, [])
      }
      byUnit.get(unit)!.push(q.quantity)
    }

    const parts: string[] = []
    for (const [unit, qtys] of byUnit) {
      const numericQtys = qtys.filter((q) => !isNaN(parseFloat(q)))
      const nonNumericQtys = qtys.filter((q) => isNaN(parseFloat(q)))

      if (numericQtys.length > 0) {
        const sum = numericQtys.reduce((acc, q) => acc + parseFloat(q), 0)
        const formatted = sum % 1 === 0 ? sum.toString() : sum.toFixed(2)
        parts.push(unit ? `${formatted} ${unit}` : formatted)
      }

      for (const q of nonNumericQtys) {
        parts.push(unit ? `${q} ${unit}` : q)
      }
    }

    return parts.join(', ')
  }

  // Handle adding a new item
  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault()
    setAddItemError(null)

    const name = newItemName.trim()
    if (!name) {
      setAddItemError('Item name is required')
      return
    }

    // Check for duplicates
    const key = name.toLowerCase()
    const exists = aggregatedIngredients.some((ing) => ing.name.toLowerCase() === key)
    if (exists) {
      setAddItemError('Item already exists')
      return
    }

    const newItem: ManualShoppingItem = {
      name,
      quantity: newItemQuantity.trim(),
      unit: newItemUnit.trim(),
    }

    addManualItem(newItem)
    setNewItemName('')
    setNewItemQuantity('')
    setNewItemUnit('')
  }

  // Count checked/unchecked
  const checkedCount = aggregatedIngredients.filter((ing) => isChecked(ing.name)).length
  const totalCount = aggregatedIngredients.length

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mt-6">
        <div className="text-center text-gray-500 dark:text-gray-400">Loading shopping cart...</div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow mt-6 transition-colors">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex justify-between items-center border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          Shopping Cart
        </h2>
        <div className="flex items-center gap-3">
          {totalCount > 0 && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {checkedCount} of {totalCount} checked
            </span>
          )}
          <span className="text-gray-400 dark:text-gray-500">
            {isExpanded ? '▼' : '▶'}
          </span>
        </div>
      </button>

      {isExpanded && (
        <>
          {/* Add Item Form */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <form onSubmit={handleAddItem} className="flex gap-2 flex-wrap">
              <input
                type="text"
                placeholder="Add item..."
                value={newItemName}
                onChange={(e) => {
                  setNewItemName(e.target.value)
                  setAddItemError(null)
                }}
                className="flex-1 min-w-[120px] px-3 py-2 min-h-[44px] text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <input
                type="text"
                placeholder="Qty"
                inputMode="decimal"
                value={newItemQuantity}
                onChange={(e) => setNewItemQuantity(e.target.value)}
                className="w-16 px-3 py-2 min-h-[44px] text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <input
                type="text"
                placeholder="Unit"
                value={newItemUnit}
                onChange={(e) => setNewItemUnit(e.target.value)}
                className="w-20 px-3 py-2 min-h-[44px] text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                className="px-4 py-2 min-h-[44px] text-base bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Add
              </button>
            </form>
            {addItemError && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{addItemError}</p>
            )}
          </div>

          {/* Items List */}
          {aggregatedIngredients.length === 0 ? (
            <div className="px-4 py-6 text-center text-gray-500 dark:text-gray-400 text-sm">
              {plans.length === 0 ? (
                <p>No meal plans this week. Add items manually above.</p>
              ) : (
                <p>No ingredients found in planned dishes.</p>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[400px] overflow-y-auto">
              {aggregatedIngredients.map((ing) => {
                const checked = isChecked(ing.name)
                const canRemove = isManualOnly(ing.name)
                const canEdit = canRemove && ing.manualIndex !== null

                return (
                  <li
                    key={ing.name}
                    className={`px-4 py-2 flex items-center gap-3 min-h-[44px] transition-colors ${
                      checked ? 'bg-gray-50/50 dark:bg-gray-700/20' : ''
                    } ${canEdit ? 'active:bg-gray-100 dark:active:bg-gray-700' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleChecked(ing.name)}
                      className="w-5 h-5 rounded border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 dark:focus:ring-offset-gray-800 cursor-pointer flex-shrink-0"
                    />
                    <div
                      className={`flex-1 flex justify-between items-center min-w-0 ${canEdit ? 'cursor-pointer' : ''}`}
                      onClick={canEdit ? () => setEditingItem({ index: ing.manualIndex!, item: manualItems[ing.manualIndex!] }) : undefined}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`text-sm transition-all truncate ${
                            checked
                              ? 'line-through text-gray-400 dark:text-gray-500'
                              : 'text-gray-900 dark:text-gray-100'
                          }`}
                        >
                          {ing.name}
                        </span>
                        {!canRemove && (
                          <span
                            className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0"
                            title="From meal plan"
                          >
                            🍽
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span
                          className={`text-xs transition-all ${
                            checked
                              ? 'text-gray-400 dark:text-gray-500'
                              : 'text-gray-500 dark:text-gray-400'
                          }`}
                        >
                          {formatQuantities(ing.quantities)}
                        </span>
                        {canRemove && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              removeManualItem(ing.name)
                            }}
                            className="w-8 h-8 flex items-center justify-center text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs"
                            title="Remove item"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      <EditItemDialog
        isOpen={editingItem !== null}
        item={editingItem?.item ?? { name: '', quantity: '', unit: '' }}
        onSave={(updated) => {
          if (editingItem !== null) {
            updateManualItem(editingItem.index, updated)
            setEditingItem(null)
          }
        }}
        onCancel={() => setEditingItem(null)}
      />
    </div>
  )
}
