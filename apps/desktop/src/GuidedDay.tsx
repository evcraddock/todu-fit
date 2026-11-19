import {
  FinishedWeek,
  finishedWeekKey,
  hasFinishedWeek,
  markDayFinished,
} from "./FinishedWeek";
import { MealParticipants, DishPortions } from "./MealPortions";
import { ActionIcon } from "./ActionIcon";
import { AssistantComposer } from "./AssistantComposer";
import { AssistantActivity } from "./AssistantActivity";
import { CreateMissingDish } from "./CreateMissingDish";
import { useEffect, useRef, useState } from "react";
import { call, type Dish, type Plan, type Operation } from "./api";
import { Field, LoadError, shift, sunday } from "./ui";
import { metrics, range } from "./NutritionTargets";
import {
  comparison,
  modelContext,
  parseReply,
  removeProposedDish,
  mealWithServings,
  type Context,
  type Proposal,
} from "./planning";
import { ai, type Reply } from "./planningWorker";
import {
  daySlots,
  restoreDayChoices,
  dayWrites,
  savedProposal,
  tallyInputs,
  type Choices,
  type Choice,
} from "./guidedPlanning";

type Scope = { root_id: string; group_id: string };
type Draft = {
  date: string;
  data: Context;
  choices: Choices;
  editing?: string;
  candidate?: Proposal;
  suggestionId?: string;
  leftovers: boolean;
  messages: {
    role: string;
    text: string;
    replaceWithMissingDish?: boolean;
    missingDish?: string;
  }[];
  exception: string;
  pending?: { id: number; requestId: string; content: string };
  approval?: { id: string; operation: Operation; mealKeys?: string[] };
  saved?: boolean;
};
export async function loadPlanningDay(
  scope: Scope,
  day: string,
  isActive: () => boolean,
  reload = false,
) {
  const targetWeek = sunday(day);
  const targetKey = JSON.stringify([
    "fit.guided-day",
    scope.root_id,
    scope.group_id,
    targetWeek,
  ]);
  const previous: Draft | null = JSON.parse(
    sessionStorage.getItem(targetKey) || "null",
  );
  const dayKey = (date: string) =>
    JSON.stringify(["fit.guided-date", scope.root_id, scope.group_id, date]);
  const cached: Draft | null =
    previous?.date === day
      ? previous
      : JSON.parse(sessionStorage.getItem(dayKey(day)) || "null");
  const next: Draft =
    !reload && cached && !cached.saved
      ? cached
      : {
          date: day,
          data: await call<Context>(
            { type: "guided_day_context", day, ...scope },
            "planning_context",
          ),
          choices: {},
          messages: [],
          leftovers: false,
          exception: "",
        };
  next.choices = restoreDayChoices(
    next.data,
    day,
    reload
      ? Object.fromEntries(
          Object.entries(cached?.choices ?? {}).filter(
            ([, choice]) => choice.kind === "unplanned",
          ),
        )
      : next.choices,
  );
  if (!isActive()) return;
  if (previous && previous.date !== day && !previous.saved)
    sessionStorage.setItem(dayKey(previous.date), JSON.stringify(previous));
  sessionStorage.removeItem(dayKey(day));
  sessionStorage.setItem(targetKey, JSON.stringify(next));
  return next;
}
export function GuidedDay({
  scope,
  revision,
  week,
  refresh,
  onAdvanceWeek,
  onViewFinishedWeek,
  onNewDish,
  createdDish,
  consumeDish,
}: {
  scope: Scope;
  revision: number;
  week: string;
  refresh: () => void;
  onNewDish: (request: string) => void;
  createdDish?: Dish;
  consumeDish: () => void;
  onAdvanceWeek: (day: string) => void;
  onViewFinishedWeek: () => void;
}) {
  const key = JSON.stringify([
    "fit.guided-day",
    scope.root_id,
    scope.group_id,
    week,
  ]);
  const [draft, setDraft] = useState<Draft | undefined>(() => {
    const stored: Draft | null = JSON.parse(
      sessionStorage.getItem(key) || "null",
    );
    if (!stored) return undefined;
    // Older sessions can have a proposal in flight for an existing meal.
    const activeKey =
      stored.editing ??
      (stored.candidate || stored.pending || stored.messages.length
        ? daySlots(stored.data, stored.date).find((s) => !stored.choices[s.key])
            ?.key
        : undefined);
    return {
      ...stored,
      editing: activeKey,
      choices: restoreDayChoices(stored.data, stored.date, stored.choices),
    };
  });
  const lastDay = shift(week, 6);
  const weekFinished = draft?.saved && hasFinishedWeek(scope, week);
  const [choosingAnotherDay, setChoosingAnotherDay] = useState(false);
  const [date, setDate] = useState(week),
    [input, updateInput] = useState(
      () => sessionStorage.getItem("fit.message:" + key) ?? "",
    ),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [retry, setRetry] = useState(0),
    [conflict, setConflict] = useState(false);
  function setInput(value: string) {
    if (value) sessionStorage.setItem("fit.message:" + key, value);
    else sessionStorage.removeItem("fit.message:" + key);
    updateInput(value);
  }
  const messagesPane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messagesPane.current) messagesPane.current.scrollTop = 0;
  }, [draft?.date]);
  const mounted = useRef(true),
    lock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function store(value: Draft) {
    sessionStorage.setItem(key, JSON.stringify(value));
    if (mounted.current) setDraft(value);
  }
  const slots = draft ? daySlots(draft.data, draft.date) : [];
  const slot =
    slots.find((s) => s.key === draft?.editing) ??
    slots.find((s) => !draft?.choices[s.key]);
  const busy =
    working || !!draft?.pending || !!draft?.approval?.mealKeys || conflict;
  function useDish(dish: Dish) {
    if (!draft || !slot) return;
    const base = draft.messages.at(-1)?.replaceWithMissingDish
      ? undefined
      : (draft.candidate ??
        (slot.original ? savedProposal(slot.original) : undefined));
    const ids = base?.dish_ids ?? [];
    const isNew = !ids.includes(dish.id);
    const portions = structuredClone(base?.portions ?? {});
    if (isNew)
      for (const id of Object.keys(draft.data.people)) {
        if (base && !Object.values(portions[id] ?? {}).some((n) => n > 0))
          continue;
        (portions[id] ??= {})[dish.id] = 1;
      }
    store({
      ...draft,
      data: {
        ...draft.data,
        dishes: [
          ...draft.data.dishes.filter((d) => d.id !== dish.id),
          { id: dish.id, name: dish.name, nutrients: dish.nutrients },
        ],
      },
      messages: [
        ...draft.messages,
        {
          role: "Assistant",
          text: `Added ${dish.name} to the proposed ${slot.type}.`,
        },
      ],
      candidate: {
        date: draft.date,
        meal_type: slot.type,
        title: base
          ? isNew
            ? base.title + " with " + dish.name
            : base.title
          : dish.name,
        dish_ids: isNew ? [...ids, dish.id] : ids,
        portions,
      },
      suggestionId: crypto.randomUUID(),
      leftovers: false,
    });
  }
  useEffect(() => {
    if (createdDish) {
      useDish(createdDish);
      consumeDish();
    }
  }, [createdDish]);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  async function openDay(day: string, reload = false) {
    const next = await loadPlanningDay(
      scope,
      day,
      () => mounted.current,
      reload,
    );
    if (!next) return;
    if (sunday(day) !== week) {
      onAdvanceWeek(day);
    } else {
      store(next);
      setDate(day);
      setConflict(false);
      setInput("");
    }
  }
  function start(day: string) {
    return run(() => openDay(day));
  }
  function saveMeals(choice?: Choice) {
    if (!draft) return;
    return run(async () => {
      const choices =
        choice && slot
          ? { ...draft.choices, [slot.key]: choice }
          : draft.choices;
      const approvedSlots = slots.filter(
        (s) => choices[s.key]?.kind === "proposal",
      );
      const loadDay = () =>
        call<Context>(
          { type: "guided_day_context", ...scope, day: draft.date },
          "planning_context",
        );
      let fingerprint = draft.data.fingerprint;
      if (!draft.approval) {
        const latest = await loadDay();
        if (latest.fingerprint !== fingerprint) {
          const used = new Set([
            ...dayWrites(approvedSlots, choices).flatMap((m) => m.dish_ids),
            ...draft.data.existing.flatMap((p) => p.dish_ids),
          ]);
          const relevant = (ctx: Context) =>
            JSON.stringify([
              ctx.people,
              ctx.existing,
              ctx.dishes
                .filter((d) => used.has(d.id))
                .sort((a, b) => a.id.localeCompare(b.id)),
            ]);
          if (relevant(latest) !== relevant(draft.data)) {
            setConflict(true);
            throw Error(
              "The meals, portions, or nutrition for this day changed. Reload current meals to continue.",
            );
          }
          fingerprint = latest.fingerprint;
        }
      }
      const approval = draft.approval ?? {
        id: crypto.randomUUID(),
        mealKeys: approvedSlots.map((s) => s.key),
        operation: {
          type: "save_guided_day",
          ...scope,
          day: draft.date,
          fingerprint,
          meals: dayWrites(approvedSlots, choices),
        },
      };
      if (!approval.mealKeys?.length) return;
      store({ ...draft, approval });
      let saved: Plan[];
      try {
        saved = await call<Plan[]>(approval.operation, "plans", approval.id);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (["invalid_input", "conflict", "not_found"].includes(code ?? "")) {
          store({ ...draft, approval: undefined });
          setConflict(code !== "invalid_input");
        }
        throw e;
      }
      const data = await loadDay();
      const next = { ...draft.choices };
      for (const [i, key] of approval.mealKeys.entries()) {
        delete next[key];
        if (data.existing.some((p) => p.id === saved[i].id))
          next[saved[i].id] = { kind: "keep" };
      }
      const finishedSlot = slot && approval.mealKeys.includes(slot.key);
      store({
        ...draft,
        choices: next,
        data,
        approval: undefined,
        ...(finishedSlot
          ? {
              editing: undefined,
              candidate: undefined,
              messages: [],
              leftovers: false,
            }
          : {}),
        exception: "",
      });
      if (mounted.current) {
        if (finishedSlot) setInput("");
        refresh();
      }
    });
  }
  function decide(choice: Choice) {
    if (!draft || !slot) return;
    const choices = { ...draft.choices, [slot.key]: choice };
    store({
      ...draft,
      choices,
      editing: undefined,
      candidate: undefined,
      messages: [],
      leftovers: false,
      exception: "",
    });
    setInput("");
    setError("");
  }
  function revise(key: string) {
    if (!draft) return;
    const item = slots.find((s) => s.key === key)!;
    const accepted = draft.choices[key];
    const candidate =
      accepted?.kind === "proposal"
        ? accepted.meal
        : item.original
          ? savedProposal(item.original)
          : undefined;
    store({
      ...draft,
      editing: key,
      candidate,
      messages: [],
      leftovers:
        accepted?.kind === "proposal"
          ? accepted.leftovers
          : !!item.original?.uses_leftovers,
      exception: "",
    });
    setInput("");
    setError("");
  }
  function suggest(message: string) {
    if (!draft || !message.trim() || busy) return;
    return run(async () => {
      const { model } = await ai<{ model: unknown }>({ type: "settings" });
      if (!model) throw Error("Choose a model in Settings → AI first.");
      // The dish editor can add recipes while this day is in progress.
      const latest = await call<Context>(
        { type: "guided_day_context", ...scope, day: draft.date },
        "planning_context",
      );
      const known = new Set(draft.data.dishes.map((d) => d.id));
      const data = {
        ...draft.data,
        dishes: [
          ...draft.data.dishes,
          ...latest.dishes.filter((d) => !known.has(d.id)),
        ],
      };
      const catalog = modelContext(data);
      const accepted = slots.flatMap((s) => {
        const c = draft.choices[s.key];
        if (c?.kind === "proposal") return [catalog.encode(c.meal)];
        return c?.kind === "keep" && s.original
          ? [catalog.encode(savedProposal(s.original))]
          : [];
      });
      const content = JSON.stringify({
        date: draft.date,
        meal_type: slot?.type ?? null,
        ...(slot
          ? {}
          : {
              task: "Discuss this day as a whole. Answer questions with meals null. Only propose a meal if the user requests a change.",
            }),
        message,
        uses_leftovers: draft.candidate
          ? draft.leftovers
          : !!slot?.original?.uses_leftovers,
        earlierMessages: draft.messages.slice(-10),
        existing: catalog.existing,
        people: catalog.people,
        dishes: catalog.dishes,
        accepted,
        current: draft.candidate
          ? catalog.encode(draft.candidate)
          : slot?.original
            ? catalog.encode(savedProposal(slot?.original))
            : null,
      });
      if (content.length > 100_000)
        throw Error("This day exceeds the assistant message size limit.");
      const { id } = await ai<{ id: number }>({
        type: "guided_conversation_create",
        model,
      });
      if (mounted.current) {
        store({
          ...draft,
          data,
          messages: [...draft.messages, { role: "You", text: message }],
          pending: { id, requestId: crypto.randomUUID(), content },
        });
        setInput("");
      }
    });
  }
  useEffect(() => {
    if (!draft?.pending) return;
    const snapshot = draft,
      pending = draft.pending,
      type = slot?.type,
      baseline = draft.candidate ?? slot?.original,
      usesLeftovers = draft.candidate
        ? draft.leftovers
        : !!slot?.original?.uses_leftovers;
    let cancelled = false,
      terminal = false;
    async function resume() {
      try {
        await ai({ type: "conversation_send", ...pending });
        while (!cancelled) {
          const r = await ai<Reply>({
            type: "conversation_reply",
            id: pending.id,
            requestId: pending.requestId,
          });
          if (cancelled) return;
          terminal = r.status === "done" || r.status === "unanswered";
          if (terminal) {
            const answer = r.answer?.model?.find((m) => m.role === "assistant");
            const text = answer?.content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join("\n");
            if (r.status === "unanswered" || answer?.errorMessage || !text)
              throw Error(
                answer?.errorMessage ||
                  r.detail ||
                  r.reason ||
                  "No suggestion received.",
              );
            const parsed = parseReply(
              text,
              snapshot.data,
              snapshot.date,
              snapshot.date,
            );
            if (
              parsed.meals &&
              (parsed.meals.length !== 1 ||
                (type && parsed.meals[0].meal_type !== type))
            )
              throw Error("Ask for one suggestion for the current meal.");
            const proposed = parsed.meals?.[0];
            const targets =
              !type && proposed
                ? slots.filter((s) => s.type === proposed.meal_type)
                : [];
            const ambiguous = targets.length > 1;
            store({
              ...snapshot,
              ...(targets.length === 1
                ? { editing: targets[0].key, saved: false }
                : {}),
              pending: undefined,
              candidate: ambiguous
                ? undefined
                : (proposed ?? snapshot.candidate),
              suggestionId: parsed.meals
                ? pending.requestId
                : snapshot.suggestionId,
              leftovers:
                usesLeftovers &&
                (!parsed.meals ||
                  (baseline?.dish_ids.length ===
                    parsed.meals[0].dish_ids.length &&
                    baseline.dish_ids.every((id) =>
                      parsed.meals![0].dish_ids.includes(id),
                    ))),
              messages: [
                ...snapshot.messages,
                {
                  role: "Assistant",
                  text: ambiguous
                    ? `There are several saved meals for ${proposed?.meal_type}. Which one would you like to change?`
                    : parsed.message,
                  missingDish: parsed.missingDish,
                  replaceWithMissingDish:
                    !parsed.meals && parsed.replaceWithMissingDish,
                },
              ],
            });
            return;
          }
          await new Promise((r) => setTimeout(r, 750));
        }
      } catch (e) {
        if (!cancelled) {
          if (terminal) store({ ...snapshot, pending: undefined });
          setError((e as Error).message);
        }
      }
    }
    void resume();
    return () => {
      cancelled = true;
    };
  }, [draft?.pending, retry]);
  function save() {
    if (!draft || slot || draft.saved) return;
    return run(async () => {
      // Recover a day approval started by an older version before finishing.
      if (draft.approval)
        await call<Plan[]>(
          draft.approval.operation,
          "plans",
          draft.approval.id,
        );
      const exceptionKey = JSON.stringify([
        "fit.guided-day-exception",
        scope.root_id,
        scope.group_id,
        draft.date,
      ]);
      const exception =
        draft.exception.trim() ||
        (issues.length ? "Finished with the listed nutrition gaps." : "");
      if (exception)
        localStorage.setItem(
          exceptionKey,
          JSON.stringify({
            date: draft.date,
            exception,
            issues,
          }),
        );
      else localStorage.removeItem(exceptionKey);
      markDayFinished(scope, draft.date);
      const completedWeek = hasFinishedWeek(scope, week);
      if (completedWeek)
        localStorage.setItem(finishedWeekKey(scope, week), "true");
      store({ ...draft, exception, approval: undefined, saved: true });
      setChoosingAnotherDay(false);
      if (mounted.current) {
        refresh();
        if (completedWeek || draft.date === lastDay) {
          setDate(draft.date);
          return;
        }
        const tomorrow = shift(draft.date, 1);
        setDate(tomorrow);
        await openDay(tomorrow);
      }
    });
  }
  const data = draft?.data;
  const accepted = draft && data ? tallyInputs(data, draft.choices) : undefined;
  const projected =
    draft && data && slot && draft.candidate
      ? tallyInputs(data, {
          ...draft.choices,
          [slot.key]: {
            kind: "proposal",
            meal: draft.candidate,
            leftovers: draft.leftovers,
          },
        })
      : accepted;
  const issues: string[] = [];
  const tables =
    data &&
    draft &&
    accepted &&
    projected &&
    Object.entries(data.people).map(([id, person]) => (
      <details key={id} open={!slot}>
        <summary>{person.name}</summary>
        <table>
          <thead>
            <tr>
              <th>Nutrient</th>
              <th>Accepted</th>
              {slot && draft.candidate && <th>If accepted</th>}
              <th>Daily target</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(
              new Set([
                "calories_kcal",
                "protein_g",
                "carbohydrates_g",
                "fat_g",
                ...Object.keys(person.targets),
              ]),
            )
              .filter((k) => k !== "water_fl_oz")
              .map((k) => {
                const b = person.targets[k as keyof typeof metrics];
                const [name, unit] = metrics[k as keyof typeof metrics];
                const a = comparison(
                    accepted.data,
                    accepted.meals,
                    draft.date,
                    id,
                    k,
                  ),
                  p = comparison(
                    projected.data,
                    projected.meals,
                    draft.date,
                    id,
                    k,
                  );
                if (
                  !slot &&
                  (a.partial ||
                    (b?.min != null && a.total < b.min) ||
                    (b?.max != null && a.total > b.max))
                )
                  issues.push(
                    person.name +
                      " · " +
                      name +
                      (a.partial ? " (incomplete data)" : " (outside target)"),
                  );
                const display = (v: typeof a) =>
                  v.partial
                    ? `${+v.total.toFixed(1)} (partial)`
                    : String(+v.total.toFixed(1));
                return (
                  <tr key={k}>
                    <th>
                      {name} ({unit})
                    </th>
                    <td>{display(a)}</td>
                    {slot && draft.candidate && <td>{display(p)}</td>}
                    <td>{(b && range(b.min, b.max)) || "No target"}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </details>
    ));
  function describe(meal: Proposal) {
    return meal.dish_ids.map((id) => (
      <div className="guided-saved-dish" key={id}>
        <strong>
          {data?.dishes.find((d) => d.id === id)?.name ?? "Missing dish"}
        </strong>
        <div>
          {Object.entries(meal.portions)
            .filter(([, servings]) => servings[id] > 0)
            .map(
              ([p, v]) =>
                (data?.people[p]?.name ??
                  slot?.original?.portions?.[p]?.name ??
                  "Member") +
                " · " +
                v[id] +
                (v[id] === 1 ? " serving" : " servings"),
            )
            .join(", ") || "Portions unknown"}
        </div>
      </div>
    ));
  }
  const previous =
    data?.existing.filter(
      (p) =>
        draft && p.date === shift(draft.date, -1) && p.meal_type === "dinner",
    ) ?? [];
  const candidate = draft?.candidate;
  const mealToSave =
    candidate && data && mealWithServings(candidate, data.dishes);
  const validCandidate =
    candidate &&
    mealToSave &&
    mealToSave.dish_ids.every((d) =>
      data?.dishes.some((dish) => dish.id === d),
    ) &&
    Object.entries(candidate.portions).every(
      ([id, v]) =>
        !!data?.people[id] &&
        Object.values(v).every((n) => Number.isFinite(n) && n > 0),
    );
  const conversation = draft?.messages.map((m, i) => (
    <div className="guided-message" key={i}>
      <strong>{m.role}</strong>
      <p>{m.text}</p>
      {slot && m.missingDish && i === draft.messages.length - 1 && (
        <CreateMissingDish
          name={m.missingDish}
          request={draft.messages[i - 1]?.text ?? ""}
          onCreate={onNewDish}
          onUse={useDish}
        />
      )}
    </div>
  ));
  return (
    <section className="dish-chat" aria-label="Guided meal planning">
      <div
        ref={messagesPane}
        className="recipe-messages planning-messages guided-day"
      >
        {weekFinished && !choosingAnotherDay ? (
          <FinishedWeek
            scope={scope}
            week={week}
            revision={revision}
            onChooseDay={start}
            disabled={busy}
          />
        ) : (
          <>
            <h3>Plan a day with me</h3>
            {hasFinishedWeek(scope, week) && (
              <button
                disabled={busy}
                onClick={() => {
                  if (weekFinished) setChoosingAnotherDay(false);
                  else onViewFinishedWeek();
                }}
              >
                View finished week
              </button>
            )}
          </>
        )}
        {draft?.saved && (
          <>
            {!weekFinished && (
              <p role="status">
                {new Date(draft.date + "T12:00:00").toLocaleDateString(
                  undefined,
                  { weekday: "long", month: "long", day: "numeric" },
                )}{" "}
                is finished.
              </p>
            )}
            {draft.exception &&
              draft.exception !==
                "Finished with the listed nutrition gaps." && (
                <p>Day note: {draft.exception}</p>
              )}
            {!weekFinished && !choosingAnotherDay && (
              <button
                onClick={() => {
                  setDate("");
                  setChoosingAnotherDay(true);
                }}
              >
                Plan another day
              </button>
            )}
          </>
        )}
        {(!draft || (draft.saved && choosingAnotherDay)) && (
          <>
            <Field label="Day to plan">
              <input
                type="date"
                min={week}
                max={draft?.saved ? undefined : shift(week, 6)}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <button
              disabled={
                busy ||
                date === draft?.date ||
                date < week ||
                (!draft?.saved && date > shift(week, 6))
              }
              onClick={() => start(date)}
            >
              Start day
            </button>
          </>
        )}
        {draft && !draft.saved && data && (
          <>
            <p>
              {draft.date} · {slot ? slot.type : "Day review"}
            </p>
            {slot && (
              <fieldset disabled={busy}>
                {slot.type === "lunch" &&
                  previous.map((plan) => (
                    <button
                      key={plan.id}
                      disabled={
                        !plan.dish_ids.length ||
                        plan.dish_ids.some(
                          (id) => !data.dishes.some((d) => d.id === id),
                        )
                      }
                      onClick={() =>
                        store({
                          ...draft,
                          candidate: {
                            date: draft.date,
                            meal_type: "lunch",
                            title: plan.title,
                            dish_ids: plan.dish_ids,
                            portions: Object.fromEntries(
                              Object.keys(data.people).map((id) => [
                                id,
                                Object.fromEntries(
                                  plan.dish_ids.map((d) => [d, 1]),
                                ),
                              ]),
                            ),
                          },
                          leftovers: true,
                        })
                      }
                    >
                      Use leftovers from {plan.title}
                    </button>
                  ))}
                {slot.original && (
                  <article className="guided-meal-card">
                    <small>Saved {slot.type}</small>
                    <h3>{slot.original.title}</h3>
                    {describe(savedProposal(slot.original))}
                    <div className="guided-meal-actions">
                      <button onClick={() => decide({ kind: "keep" })}>
                        Keep this meal
                      </button>
                      <button onClick={() => revise(slot.key)}>
                        Revise saved meal
                      </button>
                    </div>
                  </article>
                )}
                {conversation}
                {candidate && (
                  <article
                    key={draft.suggestionId ?? slot.key}
                    className="guided-meal-card"
                  >
                    <small>Proposed {slot.type}</small>
                    <h3>{candidate.title}</h3>
                    <MealParticipants
                      meal={candidate}
                      people={data.people}
                      onChange={(next) => store({ ...draft, candidate: next })}
                    />
                    {candidate.dish_ids.map((d) => (
                      <div className="guided-edit-dish" key={d}>
                        <div className="proposal-dish-name">
                          <strong>
                            {data.dishes.find((v) => v.id === d)?.name ??
                              "Missing dish"}
                          </strong>
                          <button
                            type="button"
                            className="plan-icon-button"
                            title="Remove from meal"
                            aria-label={`Remove ${data.dishes.find((item) => item.id === d)?.name ?? "dish"} from meal`}
                            onClick={() =>
                              store({
                                ...draft,
                                candidate: removeProposedDish(
                                  candidate,
                                  d,
                                  data.dishes,
                                ),
                              })
                            }
                          >
                            <ActionIcon action="delete" />
                          </button>
                        </div>
                        <DishPortions
                          meal={candidate}
                          people={data.people}
                          onChange={(next) =>
                            store({ ...draft, candidate: next })
                          }
                          dishId={d}
                          dishName={
                            data.dishes.find((item) => item.id === d)?.name ??
                            "Missing dish"
                          }
                        />
                      </div>
                    ))}
                    <div className="guided-meal-actions">
                      <label className="guided-leftovers">
                        <input
                          type="checkbox"
                          checked={draft.leftovers}
                          onChange={(e) =>
                            store({ ...draft, leftovers: e.target.checked })
                          }
                        />{" "}
                        Uses leftovers
                      </label>
                      <button
                        className="primary"
                        disabled={!validCandidate}
                        onClick={() =>
                          mealToSave &&
                          saveMeals({
                            kind: "proposal",
                            meal: mealToSave,
                            leftovers: draft.leftovers,
                          })
                        }
                      >
                        Save {slot.type}
                      </button>
                    </div>
                  </article>
                )}
                <button
                  onClick={() =>
                    suggest(
                      input.trim() ||
                        "Suggest " +
                          (candidate ? "an alternative for " : "") +
                          slot.type +
                          " for this day.",
                    )
                  }
                >
                  {candidate
                    ? "Suggest an alternative"
                    : "Suggest " + slot.type}
                </button>
                {!slot.original && (
                  <button onClick={() => decide({ kind: "unplanned" })}>
                    Leave {slot.type} unplanned
                  </button>
                )}
              </fieldset>
            )}
            {draft.approval?.mealKeys && !working && (
              <button onClick={() => saveMeals()}>Retry meal save</button>
            )}
            {conflict && (
              <button onClick={() => run(() => openDay(draft.date, true))}>
                Reload current meals
              </button>
            )}
            {!draft.approval &&
              Object.values(draft.choices).some(
                (c) => c.kind === "proposal",
              ) && (
                <button disabled={busy} onClick={() => saveMeals()}>
                  Save previously accepted meals
                </button>
              )}
            <h3>{slot ? "Meals so far" : "Day summary"}</h3>
            {slots
              .filter((s) => draft.choices[s.key])
              .map((s) => {
                const c = draft.choices[s.key];
                const m =
                  c.kind === "proposal"
                    ? c.meal
                    : c.kind === "keep" && s.original
                      ? savedProposal(s.original)
                      : undefined;
                return (
                  <article className="guided-summary-card" key={s.key}>
                    <strong>
                      {s.type} · {m?.title ?? "Unplanned"}
                    </strong>
                    {m && <div>{describe(m)}</div>}
                    <div className="guided-summary-footer">
                      {c.kind !== "unplanned" && (
                        <small>
                          {c.kind === "keep"
                            ? "Saved"
                            : c.kind === "proposal"
                              ? s.original
                                ? "Replace " + s.original.title
                                : "Pending save"
                              : ""}
                          {(
                            c.kind === "proposal"
                              ? c.leftovers
                              : c.kind === "keep" && s.original?.uses_leftovers
                          )
                            ? " · Leftovers"
                            : ""}
                        </small>
                      )}
                      {(!slot || (!candidate && s.key !== slot.key)) && (
                        <button
                          disabled={busy || !!draft.approval}
                          onClick={() => revise(s.key)}
                        >
                          Revisit {s.type}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            <h3>{slot ? "Nutrition so far" : "Daily nutrition"}</h3>
            {tables}
            {!slot && (
              <>
                {issues.length > 0 && (
                  <>
                    <h4>Needs review</h4>
                    <ul>
                      {issues.map((i, n) => (
                        <li key={n}>{i}</li>
                      ))}
                    </ul>
                    <p>Finishing the day records these nutrition gaps.</p>
                    <Field label="Note (optional)">
                      <textarea
                        disabled={!!draft.approval}
                        value={draft.exception}
                        onChange={(e) =>
                          store({ ...draft, exception: e.target.value })
                        }
                      />
                    </Field>
                  </>
                )}
                <button
                  className="primary"
                  disabled={
                    busy ||
                    (!draft.approval &&
                      Object.values(draft.choices).some(
                        (c) => c.kind === "proposal",
                      ))
                  }
                  onClick={save}
                >
                  {draft.approval ? "Retry approved save" : "Finish day"}
                </button>
              </>
            )}
          </>
        )}
        {draft && !slot && conversation}
        <LoadError error={error} />
        {draft?.pending && error && (
          <button
            onClick={() => {
              setError("");
              setRetry((r) => r + 1);
            }}
          >
            Retry response
          </button>
        )}
      </div>

      {(working || draft?.pending) && !error && (
        <AssistantActivity
          text={draft?.approval ? "Saving meal…" : "Working on your meal plan…"}
        />
      )}
      {draft && (
        <AssistantComposer
          value={input}
          onChange={setInput}
          placeholder={
            weekFinished
              ? "Message the meal planning assistant…"
              : slot
                ? "Discuss " + slot.type + "…"
                : "Ask about this day…"
          }
          disabled={busy}
          onSend={() => void suggest(input)}
        />
      )}
    </section>
  );
}
