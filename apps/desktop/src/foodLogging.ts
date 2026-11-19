import type { Dish, MealType, Plan } from "./api";

type Match = Pick<Dish, "id" | "name">;
export type LogItem = {
  name: string;
  servings: number;
  dish?: Match;
  matches: Match[];
};
export type LogDraft = { date: string; meal: MealType | ""; items: LogItem[] };

export type PlannedLog = { planId: string; title: string; items: LogItem[] };
export function plannedLogs(
  plans: Plan[],
  dishes: Match[],
  date: string,
  meal: MealType,
): PlannedLog[] {
  return plans
    .filter((p) => p.date === date && p.meal_type === meal)
    .flatMap((p) => {
      const people = Object.values(p.portions ?? {});
      return (people.length ? people : [undefined]).flatMap((person) => {
        const ids = p.dish_ids.filter(
          (id) => !person || person.servings[id] > 0,
        );
        const items = ids.flatMap((id) => {
          const dish = dishes.find((d) => d.id === id);
          return dish
            ? [
                {
                  name: dish.name,
                  dish: { id, name: dish.name },
                  servings: person?.servings[id] ?? 1,
                  matches: [],
                },
              ]
            : [];
        });
        if (!items.length || items.length !== ids.length) return [];
        return [
          {
            planId: p.id,
            title:
              (p.title || items.map((i) => i.name).join(", ")) +
              (people.length > 1 ? " · " + person?.name : ""),
            items,
          },
        ];
      });
    });
}
const normalize = (s: string) => s.trim().toLowerCase();

export function selectLogDish(
  draft: LogDraft,
  index: number,
  match: Match,
): LogDraft {
  const items = draft.items.slice();
  const duplicate = items.findIndex(
    (item, i) => i !== index && item.dish?.id === match.id,
  );
  if (duplicate >= 0) {
    items[duplicate] = {
      ...items[duplicate],
      servings: items[duplicate].servings + items[index].servings,
    };
    items.splice(index, 1);
  } else {
    items[index] = {
      ...items[index],
      dish: { id: match.id, name: match.name },
      matches: [],
    };
  }
  return { ...draft, items };
}

export const logInstructions = `Help the user record a single meal they ate. Return JSON only: {"message":"brief response","meal":"breakfast|lunch|dinner|snack","date":"YYYY-MM-DD","changes":[{"name":"dish name","servings":1}]}. Only include date and meal when supplied or changed. Resolve relative dates using today. If the meal type is missing, ask which meal. For a new food use its ordinary name for a saved-dish search. Keep a composite dish together. Default to one serving unless specified. For revisions, use the item's existing name, give its new total servings or {"name":"existing name","remove":true}. Omit unchanged items. When the user describes eating one of the listed planned meals, include its option key in "usePlan" and give only changes to that plan. Ask which one if unclear. Never claim a dish exists or the meal is saved. The app looks up dishes and the user logs the meal after review.`;

export async function applyLogReply(
  text: string,
  draft: LogDraft,
  search: (query: string) => Promise<Match[]>,
  plans: PlannedLog[] = [],
) {
  const reply = JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  );
  if (
    !reply ||
    typeof reply.message !== "string" ||
    !reply.message.trim() ||
    !Array.isArray(reply.changes ?? [])
  )
    throw Error(
      "The assistant returned an unreadable meal. Try describing it again.",
    );
  const plan = plans.find((_, i) => reply.usePlan === String(i + 1));
  let result = { ...draft, items: [...(plan?.items ?? draft.items)] };
  if (
    reply.meal &&
    ["breakfast", "lunch", "dinner", "snack"].includes(reply.meal)
  )
    result.meal = reply.meal;
  if (
    reply.date &&
    /^\d{4}-\d{2}-\d{2}$/.test(reply.date) &&
    Number.isFinite(Date.parse(reply.date)) &&
    new Date(reply.date).toISOString().startsWith(reply.date)
  )
    result.date = reply.date;
  for (const change of reply.changes ?? []) {
    if (typeof change?.name !== "string" || !change.name.trim())
      throw Error("A dish name was missing from the response.");
    const name = change.name.trim();
    const index = result.items.findIndex(
      (i) =>
        normalize(i.name) === normalize(name) ||
        (i.dish && normalize(i.dish.name) === normalize(name)),
    );
    if (change.remove === true) {
      if (index !== -1) result.items.splice(index, 1);
      continue;
    }
    const servings = change.servings ?? 1;
    if (!Number.isFinite(servings) || servings <= 0)
      throw Error("The assistant returned invalid servings.");
    if (index !== -1) {
      result.items[index] = { ...result.items[index], servings };
      continue;
    }
    const matches = (await search(name))
      .filter((d) => normalize(d.name).includes(normalize(name)))
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    result.items.push({ name, servings, matches });
    const exact = matches.filter((d) => normalize(d.name) === normalize(name));
    if (exact.length === 1)
      result = selectLogDish(result, result.items.length - 1, exact[0]);
  }
  return {
    draft: result,
    planId: plan?.planId,
    message: reply.message as string,
  };
}
