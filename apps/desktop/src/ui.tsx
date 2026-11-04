import { useEffect, useRef, useState, type ReactNode } from "react";
import { call, mutate, type Operation, type Dish, type MealType } from "./api";
export const mealTypes: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function shift(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function sunday(date: string) {
  return shift(date, -new Date(`${date}T12:00:00`).getDay());
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function useLoad<T>(
  load: () => Promise<T>,
  key: string | number,
  scope = "",
) {
  const [loaded, setLoaded] = useState<{ scope: string; data: T }>();
  const [error, setError] = useState("");
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    let active = true;
    setError("");
    latest
      .current()
      .then((value) => {
        if (active) setLoaded({ scope, data: value });
      })
      .catch((e) => {
        if (active) setError(String(e.message));
      });
    return () => {
      active = false;
    };
  }, [key, scope]);
  return { data: loaded?.scope === scope ? loaded.data : undefined, error };
}
export function LoadError({ error }: { error: string }) {
  return error ? <p role="alert">{error}</p> : null;
}
export function useAction(onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function run(action: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  // Retry identity belongs to this editor/action instance, never to another group or form.
  const retries = useRef(new Map<string, string>());
  async function send<T>(
    operation: Operation,
    resultType?: string,
  ): Promise<T> {
    const key = JSON.stringify(operation);
    const id = retries.current.get(key) ?? crypto.randomUUID();
    retries.current.set(key, id);
    const value = resultType
      ? await call<T>(operation, resultType, id)
      : await mutate(operation, id);
    retries.current.delete(key);
    return value as T;
  }
  return {
    busy,
    error,
    run,
    mutate: (operation: Operation) => send<void>(operation),
    call: <T,>(operation: Operation, resultType: string) =>
      send<T>(operation, resultType),
  };
}
// Adapted from web/src/meals/DishSelector: search name/tags and retain selected dishes.
export function DishSelector({
  dishes,
  selected,
  onChange,
}: {
  dishes: Dish[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const matching = dishes.filter(
    (d) =>
      !selected.includes(d.id) &&
      (d.name.toLowerCase().includes(search.toLowerCase()) ||
        d.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))),
  );
  return (
    <fieldset>
      <legend>Dishes</legend>
      <div className="chips">
        {selected.map((id) => (
          <button
            type="button"
            key={id}
            onClick={() => onChange(selected.filter((x) => x !== id))}
            aria-label={`Remove ${dishes.find((d) => d.id === id)?.name ?? "missing dish"}`}
          >
            {dishes.find((d) => d.id === id)?.name ?? "Missing dish"} ×
          </button>
        ))}
      </div>
      <Field label="Search dishes">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Field>
      <div className="choices">
        {matching.slice(0, 20).map((d) => (
          <button
            type="button"
            key={d.id}
            onClick={() => onChange([...selected, d.id])}
          >
            Add {d.name}
          </button>
        ))}
        {matching.length > 20 && <p>Refine your search to see more dishes.</p>}
      </div>
    </fieldset>
  );
}
export function Nutrition({ values }: { values: Record<string, number> }) {
  return (
    <div className="nutrition">
      {Object.entries(values).map(([k, v]) => (
        <span key={k}>
          {k}: {Math.round(v * 10) / 10}
        </span>
      ))}
    </div>
  );
}
export function dishNutrition(dishes: Dish[]) {
  const total: Record<string, number> = {};
  for (const d of dishes)
    for (const n of d.nutrients ?? [])
      total[`${n.name} (${n.unit})`] =
        (total[`${n.name} (${n.unit})`] ?? 0) + n.amount;
  return total;
}
export function Confirm({
  title,
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <section>
        <h2>{title}</h2>
        <p>This cannot be undone.</p>
        <div className="actions">
          <button autoFocus onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="danger" onClick={onConfirm} disabled={busy}>
            Confirm delete
          </button>
        </div>
      </section>
    </div>
  );
}
