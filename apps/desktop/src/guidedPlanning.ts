import type { MealType, Plan } from "./api";
import type { Context, Proposal } from "./planning";
export type Slot = { key: string; type: MealType; original?: Plan };
export type Choice =
  | { kind: "keep" | "unplanned" }
  | { kind: "proposal"; meal: Proposal; leftovers: boolean };
export type Choices = Record<string, Choice>;
export function daySlots(data: Context, date: string): Slot[] {
  return (["lunch", "dinner", "breakfast", "snack"] as MealType[]).flatMap(
    (type): Slot[] => {
      const existing = data.existing.filter(
        (p) => p.date === date && p.meal_type === type,
      );
      return existing.length
        ? existing.map((original) => ({ key: original.id, type, original }))
        : [{ key: type, type }];
    },
  );
}
export function savedProposal(p: Plan): Proposal {
  return {
    date: p.date,
    title: p.title,
    meal_type: p.meal_type,
    dish_ids: p.dish_ids,
    portions: Object.fromEntries(
      Object.entries(p.portions ?? {}).map(([id, v]) => [id, v.servings]),
    ),
  };
}
export function tallyInputs(data: Context, choices: Choices) {
  const existing = data.existing.filter((p) => choices[p.id]?.kind === "keep");
  const meals = Object.values(choices).flatMap((c) =>
    c.kind === "proposal" ? [c.meal] : [],
  );
  return { data: { ...data, existing }, meals };
}
export function dayWrites(slots: Slot[], choices: Choices) {
  return slots.flatMap((slot) => {
    const choice = choices[slot.key];
    return choice?.kind === "proposal"
      ? [
          {
            ...choice.meal,
            replaces: slot.original?.id,
            uses_leftovers: choice.leftovers,
          },
        ]
      : [];
  });
}
