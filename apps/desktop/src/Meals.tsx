import { usePreferences } from "./preferences";
import { PlanningAssistant } from "./PlanningAssistant";
import { ActionIcon } from "./ActionIcon";
import { Dishes } from "./Dishes";
import { loadMealWeek, loadReferencedDishes } from "./mealData";
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
function foodLogNutrition(values: Record<string, number>) {
  return Object.fromEntries(
    ["calories", "protein", "carbs", "fat"].flatMap((name) =>
      Object.entries(values).filter(
        ([key]) => key.split(" (")[0].toLowerCase() === name,
      ),
    ),
  );
}

export function Meals({
  revision,
  refresh,
  planningScope,
  logs = false,
  hasGroup = true,
}: {
  revision: number;
  refresh: () => void;
  planningScope?: { root_id: string; group_id: string };
  logs?: boolean;
  hasGroup?: boolean;
}) {
  const { timezone } = usePreferences();
  const [date, setDate] = useState(() => today(timezone));
  const [selectedDay, setSelectedDay] = useState<string>();
  const [openedDish, setOpenedDish] = useState<Dish>();
  const [edit, setEdit] = useState<Plan | Meal | "new">();
  const [newSlot, setNewSlot] = useState<{
    date: string;
    mealType: MealType;
  }>();
  const [deleting, setDeleting] = useState<{ id: string; name: string }>();
  const start = sunday(date),
    end = shift(start, 6);
  const from = selectedDay ?? start;
  const to = selectedDay ?? end;
  const week = useLoad(
    () => loadMealWeek(call, logs, hasGroup, from, to),
    `${from}:${to}:${revision}:${logs}:${hasGroup}`,
    `${from}:${to}`,
    !edit && !openedDish,
  );
  const dishes = week.data?.dishes ?? [];
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
  if (openedDish)
    return (
      <Dishes
        initialDish={openedDish}
        revision={revision}
        refresh={refresh}
        onBack={() => setOpenedDish(undefined)}
      />
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
        date={edit === "new" ? (newSlot?.date ?? selectedDay ?? date) : date}
        refresh={refresh}
        initialMealType={edit === "new" ? newSlot?.mealType : undefined}
        plan={!logs && edit !== "new" ? (edit as Plan) : undefined}
        meal={logs && edit !== "new" ? (edit as Meal) : undefined}
        logs={logs}
        hasGroup={hasGroup}
        revision={revision}
        onCancel={() => setEdit(undefined)}
        onSaved={() => {
          setEdit(undefined);
          refresh();
        }}
      />
    );
  return (
    <section
      className={`meal-calendar${logs ? " food-log" : " meal-plans"}${selectedDay ? " meal-day-details" : ""}`}
    >
      {planningScope && !logs && !selectedDay && (
        <PlanningAssistant
          key={start}
          scope={planningScope}
          week={start}
          refresh={refresh}
        />
      )}
      {selectedDay && (
        <button
          className="back-to-week"
          onClick={() => setSelectedDay(undefined)}
        >
          ← Back to week
        </button>
      )}
      <header>
        <div>
          <h1>
            {selectedDay
              ? new Date(selectedDay + "T12:00:00").toLocaleDateString(
                  undefined,
                  {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  },
                )
              : logs
                ? "Food log"
                : "Meal plans"}
          </h1>
        </div>
        <button
          className="primary"
          onClick={() => {
            setNewSlot(undefined);
            setEdit("new");
          }}
        >
          {logs ? "Log a meal" : "New meal plan"}
        </button>
      </header>
      {!selectedDay && (
        <div className="plan-week-bar" aria-label="Week navigation">
          <p className="plan-week-label">
            {new Date(start + "T12:00:00").toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
            {" – "}
            {new Date(end + "T12:00:00").toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
          <div className="plan-week-controls">
            <button
              aria-label="Previous week"
              title="Previous week"
              onClick={() => setDate(shift(start, -7))}
            >
              ←
            </button>
            <input
              type="date"
              aria-label="Week starting"
              title="Week starting Sunday; choose any date to view its week"
              required
              value={start}
              onChange={(e) => {
                if (e.target.value) setDate(sunday(e.target.value));
              }}
            />
            <button
              aria-label="Next week"
              title="Next week"
              onClick={() => setDate(shift(start, 7))}
            >
              →
            </button>
          </div>
        </div>
      )}
      <LoadError error={week.error || action.error} />
      {!week.data && <p>Loading meals…</p>}
      {(selectedDay
        ? [selectedDay]
        : Array.from({ length: 7 }, (_, i) => shift(start, i))
      ).map((day) => {
        const dayPlans = (week.data?.plans ?? []).filter((p) => p.date === day);
        const dayLogs = (week.data?.history ?? []).filter(
          (m) => m.log.date === day,
        );
        const totals = logs
          ? dayLogs.reduce<Record<string, number>>((sum, m) => {
              for (const [k, v] of Object.entries(mealNutrition(m)))
                sum[k] = (sum[k] ?? 0) + v;
              return sum;
            }, {})
          : dishNutrition(
              dayPlans.flatMap((p) =>
                p.dish_ids.flatMap((id) => {
                  const dish = dishes.find((d) => d.id === id);
                  if (!dish) return [];
                  const servings =
                    Object.values(p.portions ?? {}).reduce(
                      (sum, person) => sum + (person.servings[id] ?? 0),
                      0,
                    ) || 1;
                  return [
                    {
                      ...dish,
                      nutrients:
                        dish.nutrients?.map((n) => ({
                          ...n,
                          amount: n.amount * servings,
                        })) ?? null,
                    },
                  ];
                }),
              ),
            );
        return (
          <article className="day" key={day}>
            <div className="day-summary">
              <h2>
                {selectedDay ? (
                  "Daily nutrition"
                ) : (
                  <button
                    className="day-title-button"
                    onClick={() => setSelectedDay(day)}
                    title="View day details"
                  >
                    {new Date(day + "T12:00:00").toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                    })}
                  </button>
                )}
              </h2>
              {
                <div className="day-nutrients">
                  {["calories", "protein", "carbs", "fat"].map((name) => (
                    <div className="day-nutrient" key={name}>
                      {Object.entries(totals)
                        .filter(
                          ([key]) => key.split(" (")[0].toLowerCase() === name,
                        )
                        .map(([key, value]) => (
                          <span key={key}>
                            {key}: {Math.round(value * 10) / 10}
                          </span>
                        ))}
                    </div>
                  ))}
                  {!logs &&
                    Object.entries(totals)
                      .filter(
                        ([key]) =>
                          !["calories", "protein", "carbs", "fat"].includes(
                            key.split(" (")[0].toLowerCase(),
                          ),
                      )
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([key, value]) => (
                        <span className="day-nutrient-extra" key={key}>
                          {key}: {Math.round(value * 10) / 10}
                        </span>
                      ))}
                </div>
              }
            </div>
            <div className="day-meals">
              {logs
                ? mealTypes.map((type) => (
                    <div className="meal-column" key={type}>
                      <div className="meal-column-header">
                        <h3 className="meal-column-title">
                          {type === "snack" ? "Snacks" : type}
                        </h3>
                        <button
                          type="button"
                          className="meal-add-plan plan-icon-button"
                          title="Log a meal"
                          aria-label={`Log ${type === "snack" ? "snacks" : type} for ${day}`}
                          onClick={() => {
                            setNewSlot({ date: day, mealType: type });
                            setEdit("new");
                          }}
                        >
                          <ActionIcon action="add" />
                        </button>
                      </div>
                      {dayLogs.filter((m) => m.log.meal_type === type)
                        .length === 0 && (
                        <p className="muted">No meals logged</p>
                      )}
                      {dayLogs
                        .filter((m) => m.log.meal_type === type)
                        .map((m) => (
                          <div className="meal" key={m.log.id}>
                            {m.log.dishes.length ? (
                              m.log.dishes.map((d) => {
                                const portions = m.log.dish_portions[d.id] ?? 1;
                                return (
                                  <div className="food-log-dish" key={d.id}>
                                    <h4
                                      className="food-log-dish-title"
                                      title={d.name}
                                    >
                                      {selectedDay ? (
                                        <button
                                          className="plan-dish-link"
                                          title="View dish details"
                                          onClick={() => setOpenedDish(d)}
                                        >
                                          {d.name}
                                        </button>
                                      ) : (
                                        d.name
                                      )}
                                    </h4>
                                    <p className="muted">
                                      {portions}{" "}
                                      {portions === 1 ? "serving" : "servings"}
                                    </p>
                                  </div>
                                );
                              })
                            ) : (
                              <h4>Notes-only meal</h4>
                            )}
                            <p>{m.log.notes}</p>
                            <Nutrition
                              values={foodLogNutrition(mealNutrition(m))}
                            />
                            <div className="actions">
                              <button
                                className="plan-icon-button"
                                title="Edit log"
                                aria-label="Edit log"
                                onClick={() => setEdit(m)}
                              >
                                <ActionIcon action="edit" />
                              </button>
                              <button
                                className="plan-icon-button"
                                title="Delete log"
                                aria-label="Delete log"
                                onClick={() =>
                                  setDeleting({
                                    id: m.log.id,
                                    name: "meal log",
                                  })
                                }
                              >
                                <ActionIcon action="delete" />
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  ))
                : mealTypes.map((type) => (
                    <div className="meal-column" key={type}>
                      <div className="meal-column-header">
                        <h3 className="meal-column-title">
                          {type === "snack" ? "Snacks" : type}
                        </h3>
                        <button
                          type="button"
                          className="meal-add-plan plan-icon-button"
                          title="Add plan"
                          aria-label={`Add ${type} plan for ${day}`}
                          onClick={() => {
                            setNewSlot({ date: day, mealType: type });
                            setEdit("new");
                          }}
                        >
                          <ActionIcon action="add" />
                        </button>
                      </div>
                      {dayPlans.filter((p) => p.meal_type === type).length ===
                        0 && <p className="muted">No meals planned</p>}
                      {dayPlans
                        .filter((p) => p.meal_type === type)
                        .map((p) => (
                          <div className="meal" key={p.id}>
                            <h4>{p.title}</h4>
                            <p>
                              {[p.cook, p.uses_leftovers ? "Leftovers" : ""]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                            {selectedDay ? (
                              p.dish_ids.length ? (
                                <ul
                                  className="plan-dish-list"
                                  aria-label={`Dishes in ${p.title}`}
                                >
                                  {p.dish_ids.map((id) => (
                                    <li key={id}>
                                      {dishes.find((dish) => dish.id === id) ? (
                                        <button
                                          className="plan-dish-link"
                                          onClick={() =>
                                            setOpenedDish(
                                              dishes.find(
                                                (dish) => dish.id === id,
                                              ),
                                            )
                                          }
                                        >
                                          {
                                            dishes.find(
                                              (dish) => dish.id === id,
                                            )?.name
                                          }
                                        </button>
                                      ) : (
                                        "Missing dish"
                                      )}
                                      {Object.entries(p.portions ?? {})
                                        .filter(
                                          ([, person]) =>
                                            person.servings[id] != null,
                                        )
                                        .map(([key, person]) => (
                                          <small
                                            className="planned-portion"
                                            key={key}
                                          >
                                            {person.name} ·{" "}
                                            {person.servings[id]} servings
                                          </small>
                                        ))}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="muted">No dishes selected</p>
                              )
                            ) : (
                              !(
                                p.dish_ids.length === 1 &&
                                dishes
                                  .find((dish) => dish.id === p.dish_ids[0])
                                  ?.name.trim()
                                  .toLowerCase() ===
                                  p.title.trim().toLowerCase()
                              ) && (
                                <p>
                                  {p.dish_ids
                                    .map(
                                      (id) =>
                                        dishes.find((d) => d.id === id)?.name ??
                                        "Missing dish",
                                    )
                                    .join(", ") || "No dishes selected"}
                                </p>
                              )
                            )}
                            <div className="actions">
                              <button
                                className="plan-icon-button"
                                title="Edit plan"
                                aria-label={`Edit ${p.title}`}
                                onClick={() => setEdit(p)}
                              >
                                <ActionIcon action="edit" />
                              </button>
                              <button
                                className="plan-icon-button"
                                title="Delete plan"
                                aria-label={`Delete ${p.title}`}
                                onClick={() =>
                                  setDeleting({ id: p.id, name: p.title })
                                }
                              >
                                <ActionIcon action="delete" />
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  ))}
            </div>
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
  initialMealType,
  plan,
  meal,
  logs,
  hasGroup,
  revision,
  refresh,
  onCancel,
  onSaved,
}: {
  dishes: Dish[];
  date: string;
  initialMealType?: MealType;
  plan?: Plan;
  meal?: Meal;
  logs: boolean;
  hasGroup: boolean;
  revision: number;
  refresh: () => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [openedDish, setOpenedDish] = useState<Dish>();
  const [date, setDate] = useState(plan?.date ?? meal?.log.date ?? initialDate);
  const [mealType, setMealType] = useState<MealType>(
    plan?.meal_type ?? meal?.log.meal_type ?? initialMealType ?? "dinner",
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
  const selectedKey = JSON.stringify([...selected].sort());
  const selectedDishes = useLoad(
    () =>
      loadReferencedDishes(
        call,
        selected.filter((id) => !meal?.log.dishes.some((d) => d.id === id)),
      ),
    `${selectedKey}:${revision}`,
    selectedKey,
    !openedDish,
  );
  const choices = [
    ...(meal?.log.dishes ?? []),
    ...(selectedDishes.data ?? dishes),
  ];
  const editorWeek = sunday(date);
  const plannedMeals = useLoad(
    () =>
      call<Plan[]>(
        { type: "plans_list", from: editorWeek, to: shift(editorWeek, 6) },
        "plans",
      ),
    `${editorWeek}:${revision}`,
    editorWeek,
    logs && hasGroup && !openedDish,
  );
  const plans = plannedMeals.data ?? [];
  return (
    <>
      {openedDish && (
        <Dishes
          initialDish={openedDish}
          revision={revision}
          refresh={refresh}
          backLabel={logs ? "Back to meal log" : "Back to meal plan"}
          onBack={() => setOpenedDish(undefined)}
        />
      )}
      <div hidden={!!openedDish}>
        <section className="dish-editor meal-plan-editor">
          <header className="editor-header">
            <div>
              <h1>
                {logs
                  ? meal
                    ? "Edit meal log"
                    : "Log a meal"
                  : plan?.title || "New meal plan"}
              </h1>
            </div>
            <div className="editor-header-actions">
              <button type="button" disabled={action.busy} onClick={onCancel}>
                Cancel
              </button>
              <button
                type="submit"
                form="meal-editor-form"
                className="primary"
                disabled={action.busy}
              >
                {action.busy
                  ? "Saving…"
                  : logs
                    ? "Save meal log"
                    : "Save meal plan"}
              </button>
            </div>
          </header>
          <LoadError
            error={
              action.error ||
              selectedDishes.error ||
              (logs ? plannedMeals.error : "")
            }
          />
          <form
            id="meal-editor-form"
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
            <fieldset className="editor-layout" disabled={action.busy}>
              <div className="editor-main">
                <div className="editor-panel meal-plan-details">
                  <h2>Meal details</h2>
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
                        onChange={(e) =>
                          setMealType(e.target.value as MealType)
                        }
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
                        <input
                          value={cook}
                          onChange={(e) => setCook(e.target.value)}
                        />
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
                  {logs && (
                    <Field label="Notes">
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                    </Field>
                  )}
                </div>
                {
                  <section className="editor-panel meal-plan-nutrition">
                    <h2>Dish nutrition</h2>
                    <p className="editor-section-note">
                      {logs
                        ? "Nutrients for the servings eaten."
                        : "Amounts per serving for each selected dish."}
                    </p>
                    {!selected.length && (
                      <p className="muted">
                        Add dishes to see their nutrients.
                      </p>
                    )}
                    {selected.map((id) => {
                      const dish = choices.find((d) => d.id === id);
                      if (!dish)
                        return (
                          <p className="muted" key={id}>
                            {selectedDishes.data
                              ? "Missing dish"
                              : "Loading dish…"}
                          </p>
                        );
                      const nutrientOrder = [
                        "calories",
                        "protein",
                        "carbs",
                        "fat",
                      ];
                      const nutrients = [...(dish.nutrients ?? [])].sort(
                        (a, b) => {
                          const rank = (name: string) => {
                            const index = nutrientOrder.indexOf(
                              name.toLowerCase(),
                            );
                            return index < 0 ? nutrientOrder.length : index;
                          };
                          return (
                            rank(a.name) - rank(b.name) ||
                            a.name.localeCompare(b.name)
                          );
                        },
                      );
                      return (
                        <div className="plan-dish-nutrition" key={id}>
                          <h3>
                            <button
                              type="button"
                              onClick={() => setOpenedDish(dish)}
                              title="View dish details"
                            >
                              {dish.name}
                            </button>
                          </h3>
                          {nutrients.length ? (
                            <Nutrition
                              values={
                                logs
                                  ? foodLogNutrition(
                                      dishNutrition([
                                        {
                                          ...dish,
                                          nutrients: nutrients.map((n) => ({
                                            ...n,
                                            amount:
                                              n.amount * (portions[id] ?? 1),
                                          })),
                                        },
                                      ]),
                                    )
                                  : dishNutrition([{ ...dish, nutrients }])
                              }
                            />
                          ) : (
                            <p className="muted">No nutrient information.</p>
                          )}
                        </div>
                      );
                    })}
                  </section>
                }
              </div>
              <div className="editor-panel meal-plan-dishes">
                {
                  <>
                    <h2>Dishes for this meal</h2>
                    <p className="editor-section-note">
                      Search by name, tag, or ingredient to add dishes.
                    </p>
                  </>
                }
                <DishSelector
                  dishes={choices}
                  selected={selected}
                  onChange={setSelected}
                  onOpenDish={setOpenedDish}
                />
                {logs && (
                  <>
                    <fieldset className="meal-log-servings">
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
                  </>
                )}
              </div>
            </fieldset>
          </form>
        </section>
      </div>
    </>
  );
}
