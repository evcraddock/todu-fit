import { useEffect, useRef, useState } from "react";
import { call, type Plan, type Operation } from "./api";
import { Field, LoadError, shift } from "./ui";
import { metrics, range } from "./NutritionTargets";
import {
  comparison,
  modelContext,
  parseReply,
  type Context,
  type Proposal,
} from "./planning";
import { ai, type Reply } from "./planningWorker";
import {
  daySlots,
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
  leftovers: boolean;
  messages: { role: string; text: string }[];
  exception: string;
  pending?: { id: number; requestId: string; content: string };
  approval?: { id: string; operation: Operation };
  saved?: boolean;
};
export function GuidedDay({
  scope,
  week,
  refresh,
  onBack,
}: {
  scope: Scope;
  week: string;
  refresh: () => void;
  onBack: () => void;
}) {
  const key = JSON.stringify([
    "fit.guided-day",
    scope.root_id,
    scope.group_id,
    week,
  ]);
  const [draft, setDraft] = useState<Draft | undefined>(
    () => JSON.parse(sessionStorage.getItem(key) || "null") ?? undefined,
  );
  const [date, setDate] = useState(week),
    [input, setInput] = useState(""),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [retry, setRetry] = useState(0),
    [conflict, setConflict] = useState(false);
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
  const busy = working || !!draft?.pending;
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
  function start(day: string) {
    return run(async () => {
      const data = await call<Context>(
        { type: "guided_day_context", day, ...scope },
        "planning_context",
      );
      if (mounted.current) {
        store({
          date: day,
          data,
          choices: {},
          messages: [],
          leftovers: false,
          exception: "",
        });
        setConflict(false);
        setInput("");
      }
    });
  }
  function decide(choice: Choice) {
    if (!draft || !slot) return;
    store({
      ...draft,
      choices: { ...draft.choices, [slot.key]: choice },
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
    if (!draft || !slot || !message.trim() || busy) return;
    return run(async () => {
      const { model } = await ai<{ model: unknown }>({ type: "settings" });
      if (!model) throw Error("Choose a model in Settings → AI first.");
      const catalog = modelContext(draft.data);
      const accepted = slots.flatMap((s) => {
        const c = draft.choices[s.key];
        if (c?.kind === "proposal") return [catalog.encode(c.meal)];
        return c?.kind === "keep" && s.original
          ? [catalog.encode(savedProposal(s.original))]
          : [];
      });
      const content = JSON.stringify({
        date: draft.date,
        meal_type: slot.type,
        message,
        earlierMessages: draft.messages.slice(-10),
        existing: catalog.existing,
        people: catalog.people,
        dishes: catalog.dishes,
        accepted,
        current: draft.candidate
          ? catalog.encode(draft.candidate)
          : slot.original
            ? catalog.encode(savedProposal(slot.original))
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
          messages: [...draft.messages, { role: "You", text: message }],
          pending: { id, requestId: crypto.randomUUID(), content },
        });
        setInput("");
      }
    });
  }
  useEffect(() => {
    if (!draft?.pending || !slot) return;
    const snapshot = draft,
      pending = draft.pending,
      type = slot.type;
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
              (parsed.meals.length !== 1 || parsed.meals[0].meal_type !== type)
            )
              throw Error("Ask for one suggestion for the current meal.");
            store({
              ...snapshot,
              pending: undefined,
              candidate: parsed.meals?.[0] ?? snapshot.candidate,
              leftovers:
                snapshot.leftovers &&
                (!parsed.meals ||
                  (snapshot.candidate?.dish_ids.length ===
                    parsed.meals[0].dish_ids.length &&
                    snapshot.candidate.dish_ids.every((id) =>
                      parsed.meals![0].dish_ids.includes(id),
                    ))),
              messages: [
                ...snapshot.messages,
                { role: "Assistant", text: parsed.message },
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
      const approval = draft.approval ?? {
        id: crypto.randomUUID(),
        operation: {
          type: "save_guided_day",
          ...scope,
          day: draft.date,
          fingerprint: draft.data.fingerprint,
          meals: dayWrites(slots, draft.choices),
        },
      };
      store({ ...draft, approval });
      try {
        await call<Plan[]>(approval.operation, "plans", approval.id);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "invalid_input") store({ ...draft, approval: undefined });
        if (code === "conflict" || code === "not_found") {
          store({ ...draft, approval: undefined });
          setConflict(true);
        }
        throw e;
      }
      const exceptionKey = JSON.stringify([
        "fit.guided-day-exception",
        scope.root_id,
        scope.group_id,
        draft.date,
      ]);
      if (draft.exception.trim())
        localStorage.setItem(
          exceptionKey,
          JSON.stringify({
            date: draft.date,
            exception: draft.exception,
            issues,
          }),
        );
      else localStorage.removeItem(exceptionKey);
      store({ ...draft, approval: undefined, saved: true });
      if (mounted.current) refresh();
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
      <details key={id} open>
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
      <div key={id}>
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
                " servings",
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
  const validCandidate =
    candidate &&
    candidate.dish_ids.length > 0 &&
    candidate.dish_ids.every(
      (d) =>
        data?.dishes.some((dish) => dish.id === d) &&
        Object.values(candidate.portions).some((v) => v[d] > 0),
    ) &&
    Object.entries(candidate.portions).every(
      ([id, v]) =>
        !!data?.people[id] &&
        Object.values(v).every((n) => Number.isFinite(n) && n > 0),
    );
  return (
    <section className="dish-chat" aria-label="Guided meal planning">
      <div className="recipe-messages planning-messages guided-day">
        <button onClick={onBack}>Back to weekly assistant</button>
        <h3>Plan a day with me</h3>
        {(!draft || draft.saved) && (
          <>
            {draft?.saved && (
              <p role="status">{draft.date} saved and verified.</p>
            )}
            {draft?.saved && draft.exception && (
              <p>Recorded exception: {draft.exception}</p>
            )}
            <Field label="Day to plan">
              <input
                type="date"
                min={week}
                max={shift(week, 6)}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <button
              disabled={working || date < week || date > shift(week, 6)}
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
                {slot.type === "lunch" && (
                  <>
                    {previous.length ? (
                      <>
                        <p>
                          Is anything left from the dinner planned for{" "}
                          {shift(draft.date, -1)}?
                        </p>
                        {previous.map((plan) => (
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
                      </>
                    ) : (
                      <p>
                        No dinner was planned for the previous day. What would
                        you like for lunch?
                      </p>
                    )}
                  </>
                )}
                {slot.original && (
                  <article>
                    <small>Saved {slot.type}</small>
                    <h3>{slot.original.title}</h3>
                    {describe(savedProposal(slot.original))}
                    <button onClick={() => decide({ kind: "keep" })}>
                      Keep this meal
                    </button>
                    <button onClick={() => revise(slot.key)}>
                      Revise saved meal
                    </button>
                  </article>
                )}
                {draft.messages.map((m, i) => (
                  <p key={i}>
                    <strong>{m.role}</strong>
                    <br />
                    {m.text}
                  </p>
                ))}
                {candidate && (
                  <article>
                    <small>Proposed {slot.type}</small>
                    <h3>{candidate.title}</h3>
                    {candidate.dish_ids.map((d) => (
                      <div key={d}>
                        <strong>
                          {data.dishes.find((v) => v.id === d)?.name ??
                            "Missing dish"}
                        </strong>
                        {Object.entries(data.people).map(([id, p]) => (
                          <label className="portion-input" key={id}>
                            {p.name}
                            <input
                              aria-label={
                                p.name +
                                " servings of " +
                                data.dishes.find((v) => v.id === d)?.name
                              }
                              type="number"
                              min="0"
                              step="any"
                              value={candidate.portions[id]?.[d] ?? ""}
                              onChange={(e) => {
                                const portions = structuredClone(
                                    candidate.portions,
                                  ),
                                  n = e.target.valueAsNumber;
                                const servings = portions[id] ?? {};
                                if (n > 0) servings[d] = n;
                                else delete servings[d];
                                if (Object.keys(servings).length)
                                  portions[id] = servings;
                                else delete portions[id];
                                store({
                                  ...draft,
                                  candidate: { ...candidate, portions },
                                });
                              }}
                            />
                            servings
                          </label>
                        ))}
                      </div>
                    ))}
                    <label>
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
                        decide({
                          kind: "proposal",
                          meal: candidate,
                          leftovers: draft.leftovers,
                        })
                      }
                    >
                      Accept {slot.type}
                    </button>
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
            <h3>{slot ? "Accepted meals" : "Final day plan"}</h3>
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
                  <article key={s.key}>
                    <strong>
                      {s.type} · {m?.title ?? "Unplanned"}
                    </strong>
                    {m && describe(m)}
                    <small>
                      {c.kind === "keep"
                        ? "Keep saved meal"
                        : c.kind === "proposal"
                          ? s.original
                            ? "Replace " + s.original.title
                            : "Add meal"
                          : ""}
                      {(
                        c.kind === "proposal"
                          ? c.leftovers
                          : c.kind === "keep" && s.original?.uses_leftovers
                      )
                        ? " · Leftovers"
                        : ""}
                    </small>
                    {!slot && (
                      <button
                        disabled={busy || !!draft.approval}
                        onClick={() => revise(s.key)}
                      >
                        Revisit {s.type}
                      </button>
                    )}
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
                    <Field label="Exception for this day">
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
                    conflict ||
                    (issues.length > 0 && !draft.exception.trim())
                  }
                  onClick={save}
                >
                  {draft.approval
                    ? "Retry approved save"
                    : "Save this day to Fit?"}
                </button>
                {conflict && (
                  <button disabled={busy} onClick={() => start(draft.date)}>
                    Restart review with current plans
                  </button>
                )}
              </>
            )}
            {slot && (
              <p className="muted">
                Suggestions use your selected AI provider and this group’s
                dishes, plans and planning targets.
              </p>
            )}
          </>
        )}
        {busy && !error && <p role="status">Working…</p>}
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
      {slot && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void suggest(input);
          }}
        >
          <Field label="Message">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={"Discuss " + slot.type + "…"}
            />
          </Field>
          <button disabled={busy || !input.trim()}>Send</button>
        </form>
      )}
    </section>
  );
}
