// Application DTOs mirror todu-fit-protocol; no browser-owned document store.
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type Ingredient = { name: string; quantity: number; unit: string };
export type Nutrient = { name: string; amount: number; unit: string };
export type Dish = {
  id: string;
  name: string;
  instructions: string;
  ingredients: Ingredient[];
  nutrients: Nutrient[] | null;
  tags: string[];
  prep_time: number | null;
  cook_time: number | null;
  servings: number | null;
  image_url: string | null;
  source_url: string | null;
};
export type Plan = {
  id: string;
  date: string;
  meal_type: MealType;
  title: string;
  cook: string;
  dish_ids: string[];
  uses_leftovers: boolean;
};
export type Meal = {
  log: {
    id: string;
    date: string;
    meal_type: MealType;
    dishes: Dish[];
    dish_portions: Record<string, number>;
    notes: string | null;
    mealplan_id: string | null;
  };
  nutrients: Record<string, number>;
};
export type Group = { id: string; name: string; selected: boolean };
export type Identity = {
  state: string;
  root_id: string | null;
  groups: Group[];
};
export type Config = {
  created_by: string;
  sync_server_url: string | null;
  auto_sync: boolean;
  default_timezone: string;
};
export type Status = {
  revision: number;
  changed: boolean;
  sync: { state: string; message?: string };
};
export type Shopping = {
  cart: {
    week: string;
    checked: string[];
    manual_items: {
      name: string;
      quantity: string | null;
      unit: string | null;
    }[];
  };
  items: {
    name: string;
    quantity: number;
    unit: string;
    checked: boolean;
    is_manual: boolean;
  }[];
};
export type WaterSettings = {
  daily_goal_ml: number;
  preferred_unit: "ml" | "oz";
  timezone: string;
  quick_add_presets_ml: number[];
};
export type WaterReport = {
  settings: WaterSettings;
  entries: { id: string; consumed_at: string; amount_ml: number }[];
  days: { date: string; total_ml: number; goal_progress: number }[];
  streak_days: number;
  average_daily_ml_7d: number;
};
export type Operation = { type: string; [key: string]: unknown };
declare global {
  interface Window {
    fit: {
      request(
        operation: Operation,
        requestId?: string,
      ): Promise<
        | { ok: true; value: { type: string; data: unknown } }
        | { ok: false; error: string }
      >;
    };
  }
}
export async function call<T>(
  operation: Operation,
  resultType: string,
  requestId?: string,
): Promise<T> {
  const result = await window.fit.request(operation, requestId);
  if (!result.ok) throw new Error(result.error);
  if (result.value.type !== resultType)
    throw new Error("Unexpected application response");
  return result.value.data as T;
}
export async function mutate(
  operation: Operation,
  requestId?: string,
): Promise<void> {
  const result = await window.fit.request(operation, requestId);
  if (!result.ok) throw new Error(result.error);
}
