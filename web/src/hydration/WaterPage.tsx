import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useRepoState, RepoLoading } from '../repo'
import { ConfirmDialog } from '../components'
import { HydrationSettings, HydrationUnit, WaterEntry } from './types'
import { formatHydrationAmount, useHydration } from './useHydration'

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatGoalProgress(progress: number): string {
  return `${Math.min(Math.round(progress * 100), 999)}%`
}

function goalAmountForUnit(settings: HydrationSettings, unit: HydrationUnit, ozFromMl: (ml: number) => number): string {
  if (unit === 'ml') {
    return String(settings.dailyGoalMl)
  }

  const ounces = Math.round(ozFromMl(settings.dailyGoalMl) * 10) / 10
  return Number.isInteger(ounces) ? String(ounces.toFixed(0)) : String(ounces.toFixed(1))
}

function presetEditorValue(settings: HydrationSettings, unit: HydrationUnit, ozFromMl: (ml: number) => number): string {
  return settings.quickAddPresetsMl
    .map((preset) => {
      if (unit === 'ml') {
        return String(preset)
      }
      const ounces = Math.round(ozFromMl(preset) * 10) / 10
      return Number.isInteger(ounces) ? ounces.toFixed(0) : ounces.toFixed(1)
    })
    .join(', ')
}

export function WaterPage() {
  const { isReady, currentGroupName } = useRepoState()

  if (!isReady) {
    return <RepoLoading />
  }

  return <WaterPageContent currentGroupName={currentGroupName} />
}

function WaterPageContent({ currentGroupName }: { currentGroupName: string | null }) {
  const { todayEntries, todayTotalMl, goalProgress, settings, addEntry, deleteEntry, saveSettings, isLoading, helpers } = useHydration()
  const [customAmount, setCustomAmount] = useState('')
  const [customUnit, setCustomUnit] = useState<HydrationUnit>(settings.preferredUnit)
  const [goalInput, setGoalInput] = useState(() => goalAmountForUnit(settings, settings.preferredUnit, helpers.ozFromMl))
  const [settingsUnit, setSettingsUnit] = useState<HydrationUnit>(settings.preferredUnit)
  const [presetInput, setPresetInput] = useState(() => presetEditorValue(settings, settings.preferredUnit, helpers.ozFromMl))
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WaterEntry | null>(null)

  const settingsPresetKey = settings.quickAddPresetsMl.join(',')

  useEffect(() => {
    setCustomUnit(settings.preferredUnit)
    setSettingsUnit(settings.preferredUnit)
    setGoalInput(goalAmountForUnit(settings, settings.preferredUnit, helpers.ozFromMl))
    setPresetInput(presetEditorValue(settings, settings.preferredUnit, helpers.ozFromMl))
  }, [helpers.ozFromMl, settings.dailyGoalMl, settings.preferredUnit, settingsPresetKey])

  const totalLabel = helpers.formatHydrationAmount(todayTotalMl, settings.preferredUnit)
  const goalLabel = helpers.formatHydrationAmount(settings.dailyGoalMl, settings.preferredUnit)
  const progressWidth = `${Math.min(goalProgress * 100, 100)}%`

  const recentEntries = useMemo(() => todayEntries.slice(0, 10), [todayEntries])

  const handleQuickAdd = (amountMl: number) => {
    try {
      addEntry(amountMl, 'ml')
      setError(null)
      setSuccess(`Added ${helpers.formatHydrationAmount(amountMl, settings.preferredUnit)}`)
    } catch (err) {
      setSuccess(null)
      setError(err instanceof Error ? err.message : 'Failed to add water entry')
    }
  }

  const handleCustomSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const amount = Number(customAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setSuccess(null)
      setError('Enter a positive water amount')
      return
    }

    try {
      addEntry(amount, customUnit)
      setCustomAmount('')
      setError(null)
      setSuccess(`Added ${amount} ${customUnit === 'ml' ? 'mL' : 'oz'}`)
    } catch (err) {
      setSuccess(null)
      setError(err instanceof Error ? err.message : 'Failed to add water entry')
    }
  }

  const handleSaveSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const goalValue = Number(goalInput)
    if (!Number.isFinite(goalValue) || goalValue <= 0) {
      setSuccess(null)
      setError('Daily goal must be positive')
      return
    }

    const quickAddValues = presetInput
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map(Number)

    if (quickAddValues.length === 0 || quickAddValues.some((value) => !Number.isFinite(value) || value <= 0)) {
      setSuccess(null)
      setError('Quick-add presets must be a comma-separated list of positive numbers')
      return
    }

    const dailyGoalMl = settingsUnit === 'ml' ? Math.round(goalValue) : helpers.mlFromOz(goalValue)
    const quickAddPresetsMl = quickAddValues.map((value) => settingsUnit === 'ml' ? Math.round(value) : helpers.mlFromOz(value))

    try {
      saveSettings({
        dailyGoalMl,
        preferredUnit: settingsUnit,
        quickAddPresetsMl,
      })
      setError(null)
      setSuccess('Water settings saved')
    } catch (err) {
      setSuccess(null)
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    }
  }

  const confirmDelete = () => {
    if (!deleteTarget) {
      return
    }

    deleteEntry(deleteTarget.id)
    setSuccess(`Deleted ${helpers.formatHydrationAmount(deleteTarget.amountMl, settings.preferredUnit)} entry`)
    setError(null)
    setDeleteTarget(null)
  }

  if (isLoading) {
    return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading water tracker...</div>
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <section className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 transition-colors">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Water</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Private to you{currentGroupName ? ` and separate from shared planning in ${currentGroupName}.` : '.'}
            </p>
          </div>
          <div className="rounded-full bg-blue-100 dark:bg-blue-900/40 px-3 py-1 text-sm font-medium text-blue-700 dark:text-blue-300">
            Water only
          </div>
        </div>

        {(error || success) && (
          <div className="mt-4 space-y-2">
            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300">
                {success}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-4">
            <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Today</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{totalLabel}</p>
          </div>
          <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Goal</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{goalLabel}</p>
          </div>
          <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Progress</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{formatGoalProgress(goalProgress)}</p>
          </div>
        </div>

        <div className="mt-4">
          <div className="h-4 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: progressWidth }} />
          </div>
        </div>
      </section>

      <section className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 transition-colors">
        <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">Quick add</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">One tap adds a timestamped private water entry for right now.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {settings.quickAddPresetsMl.map((preset) => (
            <button
              key={preset}
              onClick={() => handleQuickAdd(preset)}
              className="rounded-lg bg-blue-600 px-4 py-4 text-center text-base font-medium text-white transition-colors hover:bg-blue-700"
            >
              + {helpers.formatHydrationAmount(preset, settings.preferredUnit)}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 transition-colors">
          <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">Custom entry</h2>
          <form className="mt-4 space-y-4" onSubmit={handleCustomSubmit}>
            <div>
              <label htmlFor="water-amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Amount
              </label>
              <input
                id="water-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={customAmount}
                onChange={(event) => setCustomAmount(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                placeholder={customUnit === 'ml' ? '500' : '16'}
              />
            </div>
            <div>
              <label htmlFor="water-unit" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Unit
              </label>
              <select
                id="water-unit"
                value={customUnit}
                onChange={(event) => setCustomUnit(event.target.value as HydrationUnit)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="oz">oz</option>
                <option value="ml">mL</option>
              </select>
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-green-600 px-4 py-3 font-medium text-white transition-colors hover:bg-green-700"
            >
              Add water
            </button>
          </form>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 transition-colors">
          <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">Settings</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Preferred unit changes display only. Storage stays canonical in mL.</p>
          <form className="mt-4 space-y-4" onSubmit={handleSaveSettings}>
            <div>
              <label htmlFor="water-settings-unit" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Preferred display unit
              </label>
              <select
                id="water-settings-unit"
                value={settingsUnit}
                onChange={(event) => {
                  const nextUnit = event.target.value as HydrationUnit
                  setSettingsUnit(nextUnit)
                  setGoalInput(goalAmountForUnit(settings, nextUnit, helpers.ozFromMl))
                  setPresetInput(presetEditorValue(settings, nextUnit, helpers.ozFromMl))
                }}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="oz">oz</option>
                <option value="ml">mL</option>
              </select>
            </div>
            <div>
              <label htmlFor="water-goal" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Daily goal ({settingsUnit === 'ml' ? 'mL' : 'oz'})
              </label>
              <input
                id="water-goal"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={goalInput}
                onChange={(event) => setGoalInput(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label htmlFor="water-presets" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Quick-add presets ({settingsUnit === 'ml' ? 'mL' : 'oz'})
              </label>
              <input
                id="water-presets"
                type="text"
                value={presetInput}
                onChange={(event) => setPresetInput(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                placeholder={settingsUnit === 'ml' ? '250, 500, 750' : '8, 12, 16'}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Enter a comma-separated list of positive numbers.</p>
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition-colors hover:bg-black dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
            >
              Save settings
            </button>
          </form>
        </section>
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 transition-colors">
        <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">Recent entries</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Today only. No history or reporting view is included here.</p>
        {recentEntries.length === 0 ? (
          <p className="mt-4 text-sm italic text-gray-500 dark:text-gray-400">No water logged yet today.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {recentEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-700"
              >
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">{formatHydrationAmount(entry.amountMl, settings.preferredUnit)}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{formatTimestamp(entry.consumedAt)}</p>
                </div>
                <button
                  onClick={() => setDeleteTarget(entry)}
                  className="px-3 py-2 text-sm text-red-600 transition-colors hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Delete water entry"
        message={deleteTarget ? `Delete ${helpers.formatHydrationAmount(deleteTarget.amountMl, settings.preferredUnit)} from today?` : ''}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
