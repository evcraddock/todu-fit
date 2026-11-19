import type { Dish, Plan, Meal, Operation } from "./api";

type Request = <T>(operation: Operation, resultType: string) => Promise<T>;

export async function loadReferencedDishes(request: Request, ids: string[]) {
  // The daemon bounds concurrent connections and serializes document reads.
  const dishes: Dish[] = [];
  for (const identifier of new Set(ids)) {
    try {
      dishes.push(
        await request<Dish>({ type: "dish_get", identifier }, "dish"),
      );
    } catch (error) {
      // Keep historical plans visible when a referenced dish was deleted.
      if (!(
        error instanceof Error &&
        error.message === `Dish not found: ${identifier}`
      ))
        throw error;
    }
  }
  return dishes;
}

export async function loadMealWeek(
  request: Request,
  logs: boolean,
  hasGroup: boolean,
  from: string,
  to: string,
): Promise<{ plans: Plan[]; history: Meal[]; dishes: Dish[] }> {
  if (logs) {
    const history = await request<Meal[]>(
      { type: "meals_history", from, to },
      "meals",
    );
    return { plans: [], history, dishes: [] };
  }
  if (!hasGroup) return { plans: [], history: [], dishes: [] };
  const plans = await request<Plan[]>(
    { type: "plans_list", from, to },
    "plans",
  );
  const dishes = await loadReferencedDishes(
    request,
    plans.flatMap((plan) => plan.dish_ids),
  );
  return { plans, history: [], dishes };
}
