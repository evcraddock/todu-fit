import { useState, useEffect, useRef } from 'react'
import { ManualShoppingItem } from './types'

interface EditItemDialogProps {
  isOpen: boolean
  item: ManualShoppingItem
  onSave: (updated: ManualShoppingItem) => void
  onCancel: () => void
}

export function EditItemDialog({ isOpen, item, onSave, onCancel }: EditItemDialogProps) {
  const [name, setName] = useState(item.name)
  const [quantity, setQuantity] = useState(item.quantity)
  const [unit, setUnit] = useState(item.unit)
  const nameRef = useRef<HTMLInputElement>(null)

  // Reset form when item changes
  useEffect(() => {
    if (isOpen) {
      setName(item.name)
      setQuantity(item.quantity)
      setUnit(item.unit)
      // Focus name input after render
      const timer = setTimeout(() => nameRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen, item])

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onCancel])

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) return

    onSave({
      name: trimmedName,
      quantity: quantity.trim(),
      unit: unit.trim(),
    })
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-item-title"
    >
      <div className="bg-white dark:bg-gray-800 rounded-t-xl sm:rounded-lg shadow-xl w-full sm:max-w-md p-5 pb-8 sm:pb-5">
        <h2
          id="edit-item-title"
          className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100"
        >
          Edit Item
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="edit-item-name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Name
            </label>
            <input
              ref={nameRef}
              id="edit-item-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-3 min-h-[44px] text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label
                htmlFor="edit-item-qty"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Quantity
              </label>
              <input
                id="edit-item-qty"
                type="text"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-3 py-3 min-h-[44px] text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex-1">
              <label
                htmlFor="edit-item-unit"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Unit
              </label>
              <input
                id="edit-item-unit"
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-3 min-h-[44px] text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-3 min-h-[44px] text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-3 min-h-[44px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
