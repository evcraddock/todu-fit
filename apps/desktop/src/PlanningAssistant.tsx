import { MealParticipants, DishPortions } from "./MealPortions";
import { ActionIcon } from "./ActionIcon";
import { AssistantComposer } from "./AssistantComposer";
import { AssistantActivity } from "./AssistantActivity";
import { CreateMissingDish } from "./CreateMissingDish";
import { FinishedWeek, hasFinishedWeek } from "./FinishedWeek";
import { GuidedDay, loadPlanningDay } from "./GuidedDay";
import { ai, type Reply } from "./planningWorker";
import { useEffect, useRef, useState } from "react";
import { call, type Dish, type Operation } from "./api";
import { AssistantPanel } from "./AssistantPanel";
import { Markdown } from "./Markdown";
import { LoadError, shift } from "./ui";
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

type Scope = { root_id: string; group_id: string };
type Turn = { role: string; text: string; missingDish?: string };
type Session = {
  messages: Turn[];
  meals: Proposal[];
  data?: Context;
  pending?: { id: number; requestId: string; content: string };
  approval?: { id: string; operation: Operation };
};
export function PlanningAssistant({
  scope,
  revision,
  week,
  guided,
  onNewDish,
  createdDish,
  consumeDish,
  onGuidedChange,
  onAdvanceWeek,
  refresh,
}: {
  scope: Scope;
  revision: number;
  week: string;
  guided: boolean;
  onNewDish: (request: string) => void;
  createdDish?: Dish;
  consumeDish: () => void;
  onGuidedChange: (guided: boolean) => void;
  onAdvanceWeek: (day: string) => void;
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
  const [showGuidedSummary, setShowGuidedSummary] = useState(false);
  const viewingFinished = guided
    ? showGuidedSummary
    : hasFinishedWeek(scope, week);
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
  function planWithDish(dish: Dish) {
    const original =
      session.messages.filter((m) => m.role === "You").at(-1)?.text ?? "";
    const message = `Use the saved dish "${dish.name}" for my meal plan. ${original}`;
    setInput(message);
    void send(message);
  }
  useEffect(() => {
    if (!guided && createdDish) {
      planWithDish(createdDish);
      consumeDish();
    }
  }, [createdDish]);
  async function send(message = input) {
    if (
      !message.trim() ||
      running.current ||
      session.approval ||
      session.pending
    )
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
      const catalog = modelContext(data);
      const meals = session.meals.filter(
        (m) =>
          m.dish_ids.every((id) => data.dishes.some((d) => d.id === id)) &&
          Object.keys(m.portions).every((id) => id in data.people),
      );
      const content = JSON.stringify({
        week,
        end,
        message: message.trim(),
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
        messages: [...messages, { role: "You", text: message.trim() }],
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
                {
                  role: "Assistant",
                  text: parsed.message,
                  missingDish: parsed.missingDish,
                },
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
    const prepared = session.meals.flatMap(
      (meal) => mealWithServings(meal, session.data!.dishes) ?? [],
    );
    if (prepared.length !== session.meals.length) return;
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
        meals: prepared,
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
  return (
    <AssistantPanel title="Meal planning assistant" preference="fit.plan-chat">
      {guided && !viewingFinished ? (
        <GuidedDay
          revision={revision}
          scope={scope}
          week={week}
          refresh={refresh}
          onViewFinishedWeek={() => setShowGuidedSummary(true)}
          onAdvanceWeek={onAdvanceWeek}
          onNewDish={onNewDish}
          createdDish={createdDish}
          consumeDish={consumeDish}
        />
      ) : (
        <section className="dish-chat" aria-label="Meal planning assistant">
          <div className="recipe-messages planning-messages">
            {viewingFinished ? (
              <FinishedWeek
                scope={scope}
                week={week}
                revision={revision}
                disabled={busy}
                onChooseDay={async (day) => {
                  if (running.current) return;
                  running.current = true;
                  setBusy(true);
                  setError("");
                  try {
                    if (
                      await loadPlanningDay(scope, day, () => active.current)
                    ) {
                      setShowGuidedSummary(false);
                      onAdvanceWeek(day);
                    }
                  } catch (e) {
                    if (active.current) setError((e as Error).message);
                  } finally {
                    running.current = false;
                    if (active.current) setBusy(false);
                  }
                }}
              />
            ) : (
              <button onClick={() => onGuidedChange(true)}>
                Plan a day with me
              </button>
            )}
            {!viewingFinished && !session.messages.length && (
              <>
                <h3>What meals would you like to plan?</h3>
                <p>Ask for one meal, a day, or the whole week.</p>
              </>
            )}
            {session.messages.map((m, i) => (
              <div key={i}>
                <strong>{m.role}</strong>
                <Markdown>{m.text}</Markdown>
                {m.missingDish && i === session.messages.length - 1 && (
                  <CreateMissingDish
                    name={m.missingDish}
                    request={session.messages[i - 1]?.text ?? ""}
                    onCreate={onNewDish}
                    onUse={planWithDish}
                  />
                )}
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
                    <MealParticipants
                      meal={m}
                      people={data.people}
                      onChange={(next) =>
                        store({
                          ...session,
                          meals: meals.map((meal, index) =>
                            index === i ? next : meal,
                          ),
                        })
                      }
                    />
                    {m.dish_ids.map((d) => (
                      <div key={d}>
                        <div className="proposal-dish-name">
                          <strong>
                            {data.dishes.find((x) => x.id === d)?.name}
                          </strong>
                          <button
                            type="button"
                            className="plan-icon-button"
                            title="Remove from meal"
                            aria-label={`Remove ${data.dishes.find((item) => item.id === d)?.name ?? "dish"} from meal`}
                            onClick={() =>
                              store({
                                ...session,
                                meals: meals.flatMap((meal, index) =>
                                  index === i
                                    ? (removeProposedDish(
                                        meal,
                                        d,
                                        data.dishes,
                                      ) ?? [])
                                    : meal,
                                ),
                              })
                            }
                          >
                            <ActionIcon action="delete" />
                          </button>
                        </div>
                        <DishPortions
                          meal={m}
                          people={data.people}
                          onChange={(next) =>
                            store({
                              ...session,
                              meals: meals.map((meal, index) =>
                                index === i ? next : meal,
                              ),
                            })
                          }
                          dishId={d}
                          dishName={
                            data.dishes.find((item) => item.id === d)?.name ??
                            "Missing dish"
                          }
                        />
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
                          const [name, unit] =
                            metrics[k as keyof typeof metrics];
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
                  meals.some((m) => !mealWithServings(m, data?.dishes ?? []))
                }
                onClick={save}
              >
                {session.approval
                  ? "Retry approved save"
                  : "Save approved meals"}
              </button>
            )}
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

          {busy && !error && (
            <AssistantActivity
              text={
                session.approval
                  ? "Saving meal plan…"
                  : "Working on your meal plan…"
              }
            />
          )}
          <AssistantComposer
            value={input}
            onChange={setInput}
            placeholder="Plan meals for this week…"
            disabled={busy || !!session.approval}
            onSend={() => void send()}
          />
        </section>
      )}
    </AssistantPanel>
  );
}
