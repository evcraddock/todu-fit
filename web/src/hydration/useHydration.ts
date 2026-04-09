import * as Automerge from '@automerge/automerge'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useDocument } from '../repo'
import { useRepoState } from '../repo/RepoContext'
import { CliHydrationSettings, CliWaterEntry, HydrationDoc, HydrationSettings, HydrationUnit, WaterEntry } from './types'

const ML_PER_OUNCE = 29.5735

function imm(value: string): Automerge.ImmutableString {
  return new Automerge.ImmutableString(value)
}

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

function mlFromOz(oz: number): number {
  return Math.round(oz * ML_PER_OUNCE)
}

function ozFromMl(ml: number): number {
  return ml / ML_PER_OUNCE
}

function defaultQuickAddPresetsMl(): number[] {
  return [mlFromOz(8), mlFromOz(12), mlFromOz(16), 500, 750]
}

function defaultSettings(): HydrationSettings {
  return {
    dailyGoalMl: mlFromOz(80),
    preferredUnit: 'oz',
    quickAddPresetsMl: defaultQuickAddPresetsMl(),
  }
}

function normalizePresets(presets: number[]): number[] {
  return [...new Set(presets.filter((preset) => preset > 0).map((preset) => Math.round(preset)))].sort((a, b) => a - b)
}

function convertCliEntry(id: string, entry: CliWaterEntry): WaterEntry {
  return {
    id,
    consumedAt: getString(entry.consumed_at),
    amountMl: Number(entry.amount_ml ?? 0),
    createdAt: getString(entry.created_at),
    updatedAt: getString(entry.updated_at),
  }
}

function convertCliSettings(settings?: CliHydrationSettings): HydrationSettings {
  if (!settings) {
    return defaultSettings()
  }

  return {
    dailyGoalMl: Number(settings.daily_goal_ml ?? defaultSettings().dailyGoalMl),
    preferredUnit: getString(settings.preferred_unit) === 'ml' ? 'ml' : 'oz',
    quickAddPresetsMl: normalizePresets((settings.quick_add_presets_ml ?? defaultQuickAddPresetsMl()).map(Number)),
  }
}

function isWaterEntry(value: unknown): value is CliWaterEntry {
  if (value === null || typeof value !== 'object') {
    return false
  }

  const entry = value as Record<string, unknown>
  return 'consumed_at' in entry && 'amount_ml' in entry
}

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateStringFromIso(isoString: string): string {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return localDateString(date)
}

export function formatHydrationAmount(amountMl: number, unit: HydrationUnit): string {
  if (unit === 'ml') {
    return `${Math.round(amountMl)} mL`
  }

  const ounces = ozFromMl(amountMl)
  const rounded = Math.round(ounces * 10) / 10
  const display = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)
  return `${display} oz`
}

export function useHydration() {
  const { docUrls } = useRepoState()
  const [doc, changeDoc] = useDocument<HydrationDoc>(docUrls?.hydration)
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

  const entries = useMemo(() => {
    if (!doc) return []

    return Object.entries(doc)
      .flatMap(([id, value]) => {
        if (id === 'settings' || !isWaterEntry(value)) {
          return []
        }
        return [convertCliEntry(id, value)]
      })
      .sort((a, b) => b.consumedAt.localeCompare(a.consumedAt))
  }, [doc])

  const settings = useMemo(() => convertCliSettings(doc?.settings), [doc])

  const today = localDateString(new Date())

  const todayEntries = useMemo(
    () => entries.filter((entry) => dateStringFromIso(entry.consumedAt) === today),
    [entries, today]
  )

  const todayTotalMl = useMemo(
    () => todayEntries.reduce((sum, entry) => sum + entry.amountMl, 0),
    [todayEntries]
  )

  const goalProgress = settings.dailyGoalMl > 0 ? todayTotalMl / settings.dailyGoalMl : 0

  const addEntry = useCallback((amount: number, unit: HydrationUnit) => {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Water amount must be positive')
    }

    const amountMl = unit === 'ml' ? Math.round(amount) : mlFromOz(amount)
    if (amountMl <= 0) {
      throw new Error('Water amount must be positive')
    }

    const now = new Date().toISOString()
    const id = uuidv4()

    changeDoc((d) => {
      d[id] = {
        consumed_at: imm(now) as unknown as string,
        amount_ml: amountMl,
        created_at: imm(now) as unknown as string,
        updated_at: imm(now) as unknown as string,
      } as unknown as CliWaterEntry
    })
  }, [changeDoc])

  const deleteEntry = useCallback((id: string) => {
    changeDoc((d) => {
      delete d[id]
    })
  }, [changeDoc])

  const saveSettings = useCallback((next: HydrationSettings) => {
    if (next.dailyGoalMl <= 0) {
      throw new Error('Daily goal must be positive')
    }

    const quickAddPresetsMl = normalizePresets(next.quickAddPresetsMl)
    if (quickAddPresetsMl.length === 0) {
      throw new Error('Quick-add presets cannot be empty')
    }

    changeDoc((d) => {
      d.settings = {
        daily_goal_ml: Math.round(next.dailyGoalMl),
        preferred_unit: imm(next.preferredUnit) as unknown as HydrationUnit,
        quick_add_presets_ml: quickAddPresetsMl,
      } as unknown as CliHydrationSettings
    })
  }, [changeDoc])

  return {
    entries,
    todayEntries,
    todayTotalMl,
    goalProgress,
    settings,
    addEntry,
    deleteEntry,
    saveSettings,
    isLoading: !doc && !timedOut,
    helpers: {
      mlFromOz,
      ozFromMl,
      formatHydrationAmount,
    },
  }
}
