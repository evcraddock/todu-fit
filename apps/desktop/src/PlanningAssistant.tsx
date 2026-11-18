import { useEffect, useRef, useState } from "react";
import { call, type Operation } from "./api";
import { AssistantPanel } from "./AssistantPanel";
import { Markdown } from "./Markdown";
import { Field, LoadError, shift } from "./ui";
import { metrics, range } from "./NutritionTargets";
import {
  comparison,
  modelContext,
  parseReply,
  type Context,
  type Proposal,
} from "./planning";

type Scope = { root_id: string; group_id: string };
async function ai<T>(operation: Operation): Promise<T> {
  const result = await window.fit.assistant(operation);
  if (!result.ok) throw Error(result.error);
  return result.value as T;
}
type Reply = {
  status: string;
  reason?: string;
  detail?: string;
  answer?: {
    model?: {
      role: string;
      errorMessage?: string;
      content: { type: string; text?: string }[];
    }[];
  };
};
type Turn = { role: string; text: string };
type Session = {
  messages: Turn[];
  meals: Proposal[];
  data?: Context;
  pending?: { id: number; requestId: string; content: string };
  approval?: { id: string; operation: Operation };
};
export function PlanningAssistant({
  scope,
  week,
  refresh,
}: {
  scope: Scope;
  week: string;
  refresh: () => void;
}) {
  const key = JSON.stringify([
    "fit.planning",
    scope.root_id,
    scope.group_id,
    week,
  ]);
  const [session, setSession] = useState<Session>(
    () =>
      JSON.parse(sessionStorage.getItem(key) || "null") ?? {
        messages: [],
        meals: [],
      },
  );
  const [input, setInput] = useState(""),
    [working, setBusy] = useState(false),
    [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const busy = working || !!session.pending;
  const end = shift(week, 6);
  const active = useRef(true),
    running = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  function store(next: Session) {
    sessionStorage.setItem(key, JSON.stringify(next));
    if (active.current) setSession(next);
  }
  async function send() {
    if (!input.trim() || running.current || session.approval || session.pending)
      return;
    running.current = true;
    setBusy(true);
    setError("");
    const messages = session.messages;
    try {
      const { model } = await ai<{ model: unknown }>({ type: "settings" });
      if (!model) throw Error("Choose a model in Settings → AI first.");
      const data = await call<Context>(
        { type: "planning_context", week, ...scope },
        "planning_context",
      );
      if (!active.current) return;
      if (!data.dishes.length)
        throw Error("Add a dish to this group before planning a meal.");
      const catalog = modelContext(data);
      const meals = session.meals.filter(
        (m) =>
          m.dish_ids.every((id) => data.dishes.some((d) => d.id === id)) &&
          Object.keys(m.portions).every((id) => id in data.people),
      );
      const content = JSON.stringify({
        week,
        end,
        message: input.trim(),
        previousMessages: messages.slice(-10),
        dishes: catalog.dishes,
        people: catalog.people,
        existing: catalog.existing,
        proposal: meals.map(catalog.encode),
      });
      const { id } = await ai<{ id: number }>({
        type: "planning_conversation_create",
        model,
      });
      if (!active.current) return;
      if (content.length > 100_000)
        throw Error(
          "The planning context exceeds the assistant message size limit.",
        );
      store({
        data,
        meals,
        messages: [...messages, { role: "You", text: input.trim() }],
        pending: { id, requestId: crypto.randomUUID(), content },
      });
      setInput("");
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  useEffect(() => {
    const { pending, data } = session;
    if (!pending || !data) return;
    let cancelled = false;
    async function resume(
      p: NonNullable<Session["pending"]>,
      context: Context,
    ) {
      let terminal = false;
      try {
        // The worker deduplicates submissions by requestId, including after a lost response.
        await ai({ type: "conversation_send", ...p });
        while (!cancelled) {
          const reply = await ai<Reply>({
            type: "conversation_reply",
            id: p.id,
            requestId: p.requestId,
          });
          if (cancelled) return;
          terminal = reply.status === "done" || reply.status === "unanswered";
          if (terminal) {
            const answer = reply.answer?.model?.find(
              (m) => m.role === "assistant",
            );
            if (reply.status === "unanswered" || answer?.errorMessage)
              throw Error(
                answer?.errorMessage ||
                  reply.detail ||
                  reply.reason ||
                  "The assistant could not finish its response.",
              );
            const text = answer?.content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join("\n");
            if (!text) throw Error("The assistant returned an empty response.");
            const parsed = parseReply(text, context, week, end);
            store({
              ...session,
              pending: undefined,
              meals: parsed.meals ?? session.meals,
              messages: [
                ...session.messages,
                { role: "Assistant", text: parsed.message },
              ],
            });
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 750));
        }
      } catch (e) {
        if (cancelled) return;
        if (terminal) store({ ...session, pending: undefined });
        setError((e as Error).message);
      }
    }
    void resume(pending, data);
    return () => {
      cancelled = true;
    };
  }, [session.pending, retry]);
  async function save() {
    if (
      running.current ||
      session.pending ||
      !session.data ||
      !session.meals.length
    )
      return;
    running.current = true;
    setBusy(true);
    setError("");
    const approval = session.approval ?? {
      id: crypto.randomUUID(),
      operation: {
        type: "save_planning_proposal",
        ...scope,
        week,
        fingerprint: session.data.fingerprint,
        meals: session.meals,
      },
    };
    try {
      store({ ...session, approval });
      await call(approval.operation, "plans", approval.id);
      store({
        messages: [
          ...session.messages,
          { role: "Assistant", text: "Saved the approved meals to this week." },
        ],
        meals: [],
      });
      if (active.current) refresh();
    } catch (e) {
      const message = (e as Error).message;
      if (/changed|invalid|Assign each|Unknown participant/.test(message))
        store({ ...session, approval: undefined });
      if (active.current) setError(message);
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  const { data, meals } = session;
  function portion(index: number, person: string, dish: string, n: number) {
    const revised = structuredClone(meals),
      portions = revised[index].portions;
    const entries = portions[person] ?? {};
    if (n > 0) entries[dish] = n;
    else delete entries[dish];
    if (Object.keys(entries).length) portions[person] = entries;
    else delete portions[person];
    store({ ...session, meals: revised });
  }
  return (
    <AssistantPanel title="Meal planning assistant" preference="fit.plan-chat">
      <section className="dish-chat" aria-label="Meal planning assistant">
        <div className="recipe-messages planning-messages">
          {!session.messages.length && (
            <>
              <h3>What meals would you like to plan?</h3>
              <p>
                Ask for one meal, a day, or the week. Your selected AI provider
                receives the group’s dishes, planned meals, your targets and any
                targets shared with this group.
              </p>
            </>
          )}
          {session.messages.map((m, i) => (
            <div key={i}>
              <strong>{m.role}</strong>
              <Markdown>{m.text}</Markdown>
            </div>
          ))}
          {data && meals.length > 0 && (
            <fieldset disabled={busy || !!session.approval}>
              <legend>Proposed meals</legend>
              {meals.map((m, i) => (
                <article key={i}>
                  <small>
                    {m.date} · {m.meal_type}
                  </small>
                  <h3>{m.title}</h3>
                  {m.dish_ids.map((d) => (
                    <div key={d}>
                      <strong>
                        {data.dishes.find((x) => x.id === d)?.name}
                      </strong>
                      {Object.entries(data.people).map(([p, person]) => (
                        <label className="portion-input" key={p}>
                          {person.name}
                          <input
                            type="number"
                            min="0"
                            step="any"
                            aria-label={
                              person.name +
                              " servings of " +
                              data.dishes.find((x) => x.id === d)?.name
                            }
                            value={m.portions[p]?.[d] ?? ""}
                            placeholder="0"
                            onChange={(e) =>
                              portion(i, p, d, e.target.valueAsNumber)
                            }
                          />{" "}
                          servings
                        </label>
                      ))}
                    </div>
                  ))}
                </article>
              ))}
              <h3>Daily target comparison</h3>
              {[...new Set(meals.map((m) => m.date))].sort().map((day) => (
                <div key={day}>
                  <strong>{day}</strong>
                  {Object.entries(data.people).map(([p, person]) => (
                    <details key={p} open>
                      <summary>{person.name}</summary>
                      {!Object.keys(person.targets).length && (
                        <p>No targets set.</p>
                      )}
                      {Object.entries(person.targets).map(([k, b]) => {
                        const [name, unit] = metrics[k as keyof typeof metrics];
                        const { total, partial } = comparison(
                          data,
                          meals,
                          day,
                          p,
                          k,
                        );
                        const status = partial
                          ? "Incomplete data"
                          : b.min != null && total < b.min
                            ? "Below target"
                            : b.max != null && total > b.max
                              ? "Above target"
                              : "Within target";
                        return (
                          <p key={k}>
                            {name} · {+total.toFixed(1)} {unit} /{" "}
                            {range(b.min, b.max)} {unit}
                            <br />
                            <small>{status}</small>
                          </p>
                        );
                      })}
                    </details>
                  ))}
                </div>
              ))}
            </fieldset>
          )}
          {meals.length > 0 && (
            <button
              className="primary"
              disabled={
                busy ||
                meals.some((m) =>
                  m.dish_ids.some(
                    (id) => !Object.values(m.portions).some((s) => s[id] > 0),
                  ),
                )
              }
              onClick={save}
            >
              {session.approval ? "Retry approved save" : "Save approved meals"}
            </button>
          )}
          {busy && !error && <p role="status">Working…</p>}
          {session.pending && error && (
            <button
              onClick={() => {
                setError("");
                setRetry((n) => n + 1);
              }}
            >
              Retry response
            </button>
          )}
          <LoadError error={error} />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Field label="Message">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Plan meals for this week…"
            />
          </Field>
          <button
            className="primary"
            disabled={busy || !input.trim() || !!session.approval}
          >
            Send
          </button>
        </form>
      </section>
    </AssistantPanel>
  );
}
