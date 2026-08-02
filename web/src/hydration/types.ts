export type HydrationUnit = 'ml' | 'oz'

export interface WaterEntry {
  id: string
  consumedAt: string
  amountMl: number
  createdAt: string
  updatedAt: string
}

export interface HydrationSettings {
  dailyGoalMl: number
  preferredUnit: HydrationUnit
  quickAddPresetsMl: number[]
  timezone: string
}

export interface CliWaterEntry {
  consumed_at: string
  amount_ml: number
  created_at: string
  updated_at: string
}

export interface CliHydrationSettings {
  daily_goal_ml: number
  preferred_unit: HydrationUnit
  quick_add_presets_ml: number[]
  timezone?: string
}

export interface HydrationDoc {
  settings?: CliHydrationSettings
  [key: string]: CliWaterEntry | CliHydrationSettings | undefined
}
