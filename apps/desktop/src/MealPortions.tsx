import { useState } from "react";
import type { Context, Proposal } from "./planning";

type Props = {
  meal: Proposal;
  people: Context["people"];
  onChange: (meal: Proposal) => void;
};

export function MealParticipants({ meal, people, onChange }: Props) {
  const eating = Object.entries(people).filter(([id]) =>
    Object.values(meal.portions[id] ?? {}).some((n) => n > 0),
  );
  return (
    <details className="meal-participants">
      <summary>
        Who’s eating? ·{" "}
        {eating.length === 1 ? eating[0][1].name : eating.length}
      </summary>
      {Object.entries(people).map(([id, p]) => (
        <label key={id}>
          <input
            type="checkbox"
            checked={Object.values(meal.portions[id] ?? {}).some((n) => n > 0)}
            onChange={(e) => {
              const portions = { ...meal.portions };
              if (e.target.checked)
                portions[id] = Object.fromEntries(
                  meal.dish_ids.map((d) => [d, 1]),
                );
              else delete portions[id];
              onChange({ ...meal, portions });
            }}
          />
          {p.name}
        </label>
      ))}
    </details>
  );
}

export function DishPortions({
  meal,
  people,
  onChange,
  dishId,
  dishName,
}: Props & { dishId: string; dishName: string }) {
  const [editing, setEditing] = useState<{ id: string; text: string }>();
  const entries = Object.entries(people);
  const counts = entries.map(([id]) => meal.portions[id]?.[dishId] ?? 0);
  const fields = entries.map(([id, p], i) => (
    <label className="portion-input" key={id}>
      {p.name}
      <input
        type="number"
        min="0"
        step="any"
        aria-label={p.name + " servings of " + dishName}
        value={editing?.id === id ? editing.text : counts[i]}
        onBlur={() => setEditing(undefined)}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (n < 0) return;
          setEditing({ id, text: e.target.value });
          const portions = { ...meal.portions };
          const servings = { ...portions[id] };
          if (Number.isFinite(n) && n > 0) servings[dishId] = n;
          else delete servings[dishId];
          if (Object.keys(servings).length) portions[id] = servings;
          else delete portions[id];
          onChange({ ...meal, portions });
        }}
      />
      servings
    </label>
  ));
  const same = counts.every((n) => n === counts[0]);
  const included = counts.filter((n) => n > 0).length;
  return (
    <details className="dish-portions" open={entries.length === 1}>
      <summary>
        {entries.length === 1
          ? "Adjust portions"
          : (same
              ? `${counts[0]} ${counts[0] === 1 ? "serving" : "servings"} each`
              : `${included} of ${entries.length} eating`) +
            " · Adjust portions"}
      </summary>
      {fields}
    </details>
  );
}
