import type { Dish, MealType, Plan } from "./api";
import type { Profile } from "./NutritionTargets";

export type Proposal = Pick<
  Plan,
  "date" | "meal_type" | "title" | "dish_ids"
> & { portions: Record<string, Record<string, number>> };
export type Context = {
  fingerprint: string;
  dishes: Pick<Dish, "id" | "name" | "nutrients">[];
  people: Record<string, Profile>;
  existing: Plan[];
};
export function removeProposedDish(
  meal: Proposal,
  id: string,
  dishes: Context["dishes"],
): Proposal | undefined {
  const remaining = meal.dish_ids.filter((d) => d !== id);
  if (!remaining.length) return undefined;
  const portions = structuredClone(meal.portions);
  for (const [person, servings] of Object.entries(portions)) {
    delete servings[id];
    if (!Object.keys(servings).length) delete portions[person];
  }
  const removed = dishes.find((d) => d.id === id)?.name;
  const title =
    remaining.length === 1 ||
    (removed && meal.title.toLowerCase().includes(removed.toLowerCase()))
      ? remaining
          .map(
            (d) => dishes.find((item) => item.id === d)?.name ?? "Missing dish",
          )
          .join(" with ")
      : meal.title;
  return { ...meal, title, dish_ids: remaining, portions };
}
export function mealWithServings(
  meal: Proposal,
  dishes: Context["dishes"],
): Proposal | undefined {
  let result: Proposal | undefined = meal;
  for (const id of meal.dish_ids) {
    if (!Object.values(meal.portions).some((servings) => servings[id] > 0)) {
      result = removeProposedDish(result, id, dishes);
      if (!result) return undefined;
    }
  }
  return result.dish_ids.length ? result : undefined;
}
export function modelContext(data: Context) {
  const dishKeys = new Map(data.dishes.map((d, i) => [d.id, "d" + (i + 1)]));
  const personKeys = new Map(
    Object.keys(data.people).map((p, i) => [p, "p" + (i + 1)]),
  );
  const encode = (meal: Proposal) => ({
    ...meal,
    dish_ids: meal.dish_ids.map((id) => dishKeys.get(id)),
    portions: Object.fromEntries(
      Object.entries(meal.portions)
        .filter(([p]) => personKeys.has(p))
        .map(([p, servings]) => [
          personKeys.get(p),
          Object.fromEntries(
            Object.entries(servings).map(([d, n]) => [dishKeys.get(d), n]),
          ),
        ]),
    ),
  });
  return {
    encode,
    dishes: data.dishes.map((d) => ({
      id: dishKeys.get(d.id),
      name: d.name,
      nutrients: d.nutrients?.map((n) => [n.name, n.amount, n.unit]),
    })),
    people: Object.entries(data.people).map(([p, profile]) => ({
      id: personKeys.get(p),
      ...profile,
    })),
    existing: data.existing.map((p) =>
      encode({
        date: p.date,
        title: p.title,
        meal_type: p.meal_type,
        dish_ids: p.dish_ids,
        portions: Object.fromEntries(
          Object.entries(p.portions ?? {}).map(([id, v]) => [id, v.servings]),
        ),
      }),
    ),
  };
}
export function parseReply(
  text: string,
  data: Context,
  start: string,
  end: string,
): {
  message: string;
  meals?: Proposal[];
  missingDish?: string;
  replaceWithMissingDish?: boolean;
} {
  const trimmed = text
    .trim()
    .replace(/^\x60\x60\x60(?:json)?\s*/i, "")
    .replace(/\s*\x60\x60\x60$/, "");
  if (!trimmed.startsWith("{")) return { message: trimmed };
  const reply = JSON.parse(trimmed);
  if (typeof reply.message !== "string")
    throw Error(
      "The assistant returned an unreadable reply. Ask it to try again.",
    );
  const name =
    typeof reply.missingDish === "string" ? reply.missingDish.trim() : "";
  const missing =
    name &&
    name.length <= 200 &&
    !data.dishes.some((d) => d.name.trim().toLowerCase() === name.toLowerCase())
      ? {
          missingDish: name,
          ...(reply.replaceWithMissingDish === true
            ? { replaceWithMissingDish: true }
            : {}),
        }
      : {};
  if (reply.meals == null) return { message: reply.message, ...missing };
  const valid = (ok: unknown) => {
    if (!ok)
      throw Error(
        "The proposal contains an invalid meal, dish or portion. Ask the assistant to revise it.",
      );
  };
  const catalog = modelContext(data);
  const dishes = new Map(
    catalog.dishes.map((d, i) => [d.id, data.dishes[i].id]),
  );
  const people = new Map(
    catalog.people.map((p, i) => [p.id, Object.keys(data.people)[i]]),
  );
  valid(Array.isArray(reply.meals) && reply.meals.length <= 28);
  const meals: Proposal[] = reply.meals.map((m: Proposal) => {
    valid(
      m &&
        typeof m.date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(m.date) &&
        m.date >= start &&
        m.date <= end &&
        new Date(m.date + "T12:00:00Z").toISOString().startsWith(m.date) &&
        ["breakfast", "lunch", "dinner", "snack"].includes(m.meal_type) &&
        typeof m.title === "string" &&
        m.title.trim(),
    );
    valid(
      Array.isArray(m.dish_ids) &&
        m.dish_ids.length &&
        new Set(m.dish_ids).size === m.dish_ids.length &&
        m.dish_ids.every((id) => dishes.has(id)),
    );
    valid(
      m.portions &&
        typeof m.portions === "object" &&
        !Array.isArray(m.portions),
    );
    const portions: Proposal["portions"] = {},
      assigned = new Set<string>();
    for (const [p, servings] of Object.entries(m.portions)) {
      valid(
        people.has(p) &&
          servings &&
          typeof servings === "object" &&
          !Array.isArray(servings) &&
          Object.keys(servings).length,
      );
      const translated: Record<string, number> = {};
      for (const [id, n] of Object.entries(servings)) {
        valid(m.dish_ids.includes(id) && Number.isFinite(n) && n >= 0);
        if (n === 0) continue;
        translated[dishes.get(id)!] = n;
        assigned.add(id);
      }
      if (Object.keys(translated).length) portions[people.get(p)!] = translated;
    }
    valid(assigned.size === m.dish_ids.length);
    return {
      date: m.date,
      meal_type: m.meal_type as MealType,
      title: m.title.trim(),
      dish_ids: m.dish_ids.map((id) => dishes.get(id)!),
      portions,
    };
  });
  return { message: reply.message, meals, ...missing };
}

const aliases: Record<string, string> = {
  calories: "calories_kcal",
  energy: "calories_kcal",
  protein: "protein_g",
  carbs: "carbohydrates_g",
  carbohydrate: "carbohydrates_g",
  carbohydrates: "carbohydrates_g",
  "total carbohydrates": "carbohydrates_g",
  fat: "fat_g",
  "total fat": "fat_g",
  "saturated fat": "saturated_fat_g",
  fiber: "fiber_g",
  "dietary fiber": "fiber_g",
  "added sugar": "added_sugar_g",
  "added sugars": "added_sugar_g",
  sodium: "sodium_mg",
  water: "water_fl_oz",
};
export function comparison(
  data: Context,
  meals: Proposal[],
  date: string,
  person: string,
  metric: string,
) {
  let total = 0,
    unknown = false;
  const assigned = [
    ...data.existing
      .filter((p) => p.date === date)
      .map((p) => p.portions?.[person]?.servings),
    ...meals.filter((p) => p.date === date).map((p) => p.portions[person]),
  ];
  for (const portions of assigned) {
    for (const [dish, count] of Object.entries(portions ?? {})) {
      const nutrients = data.dishes.find((d) => d.id === dish)?.nutrients;
      const n = nutrients?.find(
        (n) => aliases[n.name.trim().toLowerCase()] === metric,
      );
      const unit = n?.unit.toLowerCase().trim();
      const expected = metric.slice(metric.lastIndexOf("_") + 1);
      const factor =
        metric === "water_fl_oz"
          ? unit === "fl oz"
            ? 1
            : unit === "ml"
              ? 1 / 29.5735295625
              : undefined
          : unit === expected
            ? 1
            : unit === "g" && expected === "mg"
              ? 1000
              : unit === "mg" && expected === "g"
                ? 0.001
                : undefined;
      if (!n || factor == null) unknown = true;
      else total += n.amount * count * factor;
    }
  }
  const unassigned = data.existing.some(
    (p) =>
      p.date === date &&
      p.dish_ids.some(
        (id) => !Object.values(p.portions ?? {}).some((v) => id in v.servings),
      ),
  );
  return { total, partial: unknown || unassigned };
}
