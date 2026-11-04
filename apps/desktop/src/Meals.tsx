import { useState } from "react";
import { call, type Dish, type Plan, type Meal, type MealType } from "./api";
import {
  Field,
  useLoad,
  useAction,
  LoadError,
  DishSelector,
  Nutrition,
  dishNutrition,
  Confirm,
  mealTypes,
  today,
  shift,
  sunday,
} from "./ui";
export function Meals({
  dishes,
  revision,
  refresh,
  logs = false,
  hasGroup = true,
}: {
  dishes: Dish[];
  revision: number;
  refresh: () => void;
  logs?: boolean;
  hasGroup?: boolean;
}) {
  const [date, setDate] = useState(today());
  const [edit, setEdit] = useState<Plan | Meal | "new">();
  const [deleting, setDeleting] = useState<{ id: string; name: string }>();
  const start = sunday(date),
    end = shift(start, 6);
  const plans = useLoad(
    () =>
      hasGroup
        ? call<Plan[]>({ type: "plans_list", from: start, to: end }, "plans")
        : Promise.resolve([]),
    `${start}:${revision}`,
    start,
  );
  const history = useLoad(
    () =>
      call<Meal[]>({ type: "meals_history", from: start, to: end }, "meals"),
    `${start}:${revision}`,
    start,
  );
  const action = useAction(refresh);
  const mealNutrition = (m: Meal) =>
    dishNutrition(
      m.log.dishes.map((d) => ({
        ...d,
        nutrients:
          d.nutrients?.map((n) => ({
            ...n,
            amount: n.amount * (m.log.dish_portions[d.id] ?? 1),
          })) ?? null,
      })),
    );
  if (edit)
    return (
      <MealEditor
        key={
          typeof edit === "string"
            ? edit
            : "log" in edit
              ? edit.log.id
              : edit.id
        }
        dishes={dishes}
        date={date}
        plan={!logs && edit !== "new" ? (edit as Plan) : undefined}
        meal={logs && edit !== "new" ? (edit as Meal) : undefined}
        logs={logs}
        plans={plans.data ?? []}
        onCancel={() => setEdit(undefined)}
        onSaved={() => {
          setEdit(undefined);
          refresh();
        }}
      />
    );
  return (
    <section>
      <header>
        <div>
          <p className="eyebrow">{logs ? "YOUR FOOD HISTORY" : "YOUR WEEK"}</p>
          <h1>{logs ? "Food log" : "Meal plans"}</h1>
        </div>
        <button className="primary" onClick={() => setEdit("new")}>
          {logs ? "Log a meal" : "New meal plan"}
        </button>
      </header>
      <div className="row">
        <button onClick={() => setDate(shift(date, -7))}>
          ← Previous week
        </button>
        <Field label="Week containing">
          <input
            type="date"
            required
            value={date}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
          />
        </Field>
        <button onClick={() => setDate(shift(date, 7))}>Next week →</button>
      </div>
      <p>
        {start} – {end}
      </p>
      <LoadError error={plans.error || history.error || action.error} />
      {(!plans.data || !history.data) && <p>Loading meals…</p>}
      {Array.from({ length: 7 }, (_, i) => shift(start, i)).map((day) => {
        const dayPlans = (plans.data ?? []).filter((p) => p.date === day);
        const dayLogs = (history.data ?? []).filter((m) => m.log.date === day);
        const totals = logs
          ? dayLogs.reduce<Record<string, number>>((sum, m) => {
              for (const [k, v] of Object.entries(mealNutrition(m)))
                sum[k] = (sum[k] ?? 0) + v;
              return sum;
            }, {})
          : dishNutrition(
              dayPlans.flatMap((p) =>
                p.dish_ids.flatMap(
                  (id) => dishes.find((d) => d.id === id) ?? [],
                ),
              ),
            );
        return (
          <article className="day" key={day}>
            <h2>
              {new Date(day + "T12:00:00").toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </h2>
            <Nutrition values={totals} />
            {logs
              ? dayLogs.map((m) => (
                  <div className="meal" key={m.log.id}>
                    <h3>{m.log.meal_type}</h3>
                    <p>
                      {m.log.dishes
                        .map(
                          (d) =>
                            `${d.name} (${m.log.dish_portions[d.id] ?? 1} serving${(m.log.dish_portions[d.id] ?? 1) === 1 ? "" : "s"})`,
                        )
                        .join(", ") || "Notes-only meal"}
                    </p>
                    <p>{m.log.notes}</p>
                    <Nutrition values={mealNutrition(m)} />
                    <div className="actions">
                      <button onClick={() => setEdit(m)}>Edit log</button>
                      <button
                        onClick={() =>
                          setDeleting({ id: m.log.id, name: "meal log" })
                        }
                      >
                        Delete log
                      </button>
                    </div>
                  </div>
                ))
              : dayPlans.map((p) => (
                  <div className="meal" key={p.id}>
                    <h3>{p.title}</h3>
                    <p>
                      {p.meal_type}
                      {p.cook && ` · ${p.cook}`}
                      {p.uses_leftovers && " · Leftovers"}
                    </p>
                    <p>
                      {p.dish_ids
                        .map(
                          (id) =>
                            dishes.find((d) => d.id === id)?.name ??
                            "Missing dish",
                        )
                        .join(", ") || "No dishes selected"}
                    </p>
                    <Nutrition
                      values={dishNutrition(
                        p.dish_ids.flatMap(
                          (id) => dishes.find((d) => d.id === id) ?? [],
                        ),
                      )}
                    />
                    <div className="actions">
                      <button onClick={() => setEdit(p)}>Edit plan</button>
                      <button
                        onClick={() => setDeleting({ id: p.id, name: p.title })}
                      >
                        Delete plan
                      </button>
                    </div>
                  </div>
                ))}
            {(logs ? dayLogs : dayPlans).length === 0 && (
              <p className="muted">
                {logs ? "No meals logged." : "No meals planned."}
              </p>
            )}
          </article>
        );
      })}
      {deleting && (
        <Confirm
          title={`Delete ${deleting.name}?`}
          busy={action.busy}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() =>
            action.run(async () => {
              await action.mutate({
                type: logs ? "meal_delete" : "plan_delete",
                id: deleting.id,
              });
              setDeleting(undefined);
            })
          }
        />
      )}
    </section>
  );
}
// Adapted from web MealPlanForm/MealLogForm: explicit date, meal type, dish search,
// leftovers and portions, with committed daemon responses before leaving the form.
function MealEditor({
  dishes,
  date: initialDate,
  plan,
  meal,
  logs,
  plans,
  onCancel,
  onSaved,
}: {
  dishes: Dish[];
  date: string;
  plan?: Plan;
  meal?: Meal;
  logs: boolean;
  plans: Plan[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(plan?.date ?? meal?.log.date ?? initialDate);
  const [mealType, setMealType] = useState<MealType>(
    plan?.meal_type ?? meal?.log.meal_type ?? "dinner",
  );
  const [title, setTitle] = useState(plan?.title ?? "");
  const [cook, setCook] = useState(plan?.cook ?? "");
  const [leftovers, setLeftovers] = useState(plan?.uses_leftovers ?? false);
  const [selected, setSelected] = useState(
    plan?.dish_ids ?? meal?.log.dishes.map((d) => d.id) ?? [],
  );
  const [notes, setNotes] = useState(meal?.log.notes ?? "");
  const [portions, setPortions] = useState<Record<string, number>>(
    meal?.log.dish_portions ?? {},
  );
  const [planId, setPlanId] = useState(meal?.log.mealplan_id ?? "");
  const action = useAction(onSaved);
  const choices = [
    ...dishes,
    ...(meal?.log.dishes ?? []).filter(
      (d) => !dishes.some((x) => x.id === d.id),
    ),
  ];
  return (
    <section>
      <h1>
        {logs
          ? meal
            ? "Edit meal log"
            : "Log a meal"
          : plan
            ? "Edit meal plan"
            : "New meal plan"}
      </h1>
      <LoadError error={action.error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action.run(() =>
            action.mutate(
              logs
                ? {
                    type: "meal_save",
                    id: meal?.log.id,
                    date,
                    meal_type: mealType,
                    dishes: selected,
                    portions: Object.fromEntries(
                      selected.map((id) => [id, portions[id] ?? 1]),
                    ),
                    notes,
                    plan_id: planId || undefined,
                  }
                : plan
                  ? {
                      type: "plan_update",
                      id: plan.id,
                      fields: {
                        date,
                        meal_type: mealType,
                        title,
                        cook,
                        uses_leftovers: leftovers,
                        dishes: selected,
                      },
                    }
                  : {
                      type: "plan_create",
                      date,
                      meal_type: mealType,
                      title: title || undefined,
                      cook,
                      dishes: selected,
                      uses_leftovers: leftovers,
                    },
            ),
          );
        }}
      >
        <fieldset disabled={action.busy}>
          <div className="row">
            <Field label="Date">
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Meal type">
              <select
                value={mealType}
                onChange={(e) => setMealType(e.target.value as MealType)}
              >
                {mealTypes.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>
          {!logs ? (
            <>
              <Field label="Title">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`${mealType} on ${date}`}
                />
              </Field>
              <Field label="Cook">
                <input value={cook} onChange={(e) => setCook(e.target.value)} />
              </Field>
              <label className="check">
                <input
                  type="checkbox"
                  checked={leftovers}
                  onChange={(e) => setLeftovers(e.target.checked)}
                />{" "}
                This meal uses leftovers
              </label>
              <p className="muted">
                Leftovers do not add ingredients to the shopping list.
              </p>
            </>
          ) : (
            <Field label="Use a planned meal">
              <select
                value={planId}
                onChange={(e) => {
                  setPlanId(e.target.value);
                  const p = plans.find((p) => p.id === e.target.value);
                  if (p) {
                    setDate(p.date);
                    setMealType(p.meal_type);
                    setSelected(p.dish_ids);
                  }
                }}
              >
                <option value="">Unplanned meal</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.date} · {p.title}
                  </option>
                ))}
                {planId && !plans.some((p) => p.id === planId) && (
                  <option value={planId}>Original meal plan</option>
                )}
              </select>
            </Field>
          )}
          <DishSelector
            dishes={choices}
            selected={selected}
            onChange={setSelected}
          />
          {logs && (
            <>
              <fieldset>
                <legend>Servings eaten</legend>
                {selected.map((id) => (
                  <Field
                    key={id}
                    label={`${choices.find((d) => d.id === id)?.name ?? "Dish"} servings`}
                  >
                    <input
                      type="number"
                      required
                      min="0.01"
                      step="any"
                      value={portions[id] ?? 1}
                      onChange={(e) =>
                        setPortions({
                          ...portions,
                          [id]: Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                ))}
              </fieldset>
              <Field label="Notes">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
            </>
          )}
          <div className="actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="primary">
              {action.busy
                ? "Saving…"
                : logs
                  ? "Save meal log"
                  : "Save meal plan"}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
