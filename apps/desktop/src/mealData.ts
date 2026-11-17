import type { Dish, Plan, Meal, Operation } from "./api";

type Request = <T>(operation: Operation, resultType: string) => Promise<T>;

export async function loadReferencedDishes(request: Request, ids: string[]) {
  return Promise.all(
    [...new Set(ids)].map((identifier) =>
      request<Dish>({ type: "dish_get", identifier }, "dish"),
    ),
  );
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
