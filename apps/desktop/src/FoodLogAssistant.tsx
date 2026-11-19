import { useEffect, useRef, useState } from "react";
import { call, type Dish } from "./api";
import { AssistantPanel } from "./AssistantPanel";
import { AssistantComposer } from "./AssistantComposer";
import { AssistantActivity } from "./AssistantActivity";
import { ai, type Reply } from "./planningWorker";
import {
  applyLogReply,
  logInstructions,
  selectLogDish,
  type LogDraft,
  type PlannedLog,
} from "./foodLogging";
import { LoadError } from "./ui";
import { ActionIcon } from "./ActionIcon";

type Session = {
  messages: { role: "You" | "Assistant"; text: string }[];
  pending?: { id: number; requestId: string; content: string };
};

export function FoodLogAssistant({
  today,
  plans,
  selectedPlan,
  draft,
  onChange,
  onCreate,
  onBusy,
  disabled,
  hidden,
}: {
  today: string;
  plans: PlannedLog[];
  selectedPlan: string;
  draft: LogDraft;
  onChange: (draft: LogDraft, planId?: string) => void;
  onCreate: (index: number) => void;
  onBusy: (busy: boolean) => void;
  disabled: boolean;
  hidden: boolean;
}) {
  const [session, store] = useState<Session>({ messages: [] });
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const { pending } = session;
  const busy = working || !!pending;
  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  async function send() {
    const message = input.trim();
    if (!message || lock.current || pending || disabled) return;
    lock.current = true;
    setWorking(true);
    setError("");
    try {
      const settings = await ai<{ model: unknown }>({ type: "settings" });
      if (!settings.model)
        throw Error(
          "Choose a model in Settings → AI to use the food logging assistant.",
        );
      const { id } = await ai<{ id: number }>({
        type: "conversation_create",
        model: settings.model,
      });
      if (!active.current) return;
      const content =
        logInstructions +
        "\n" +
        JSON.stringify({
          today,
          draft: {
            date: draft.date,
            meal: draft.meal,
            items: draft.items.map((i) => ({
              name: i.name,
              matched: i.dish?.name,
              servings: i.servings,
            })),
          },
          plannedMeals: plans.map((plan, i) => ({
            key: String(i + 1),
            title: plan.title,
            items: plan.items.map(({ name, servings }) => ({ name, servings })),
          })),
          recentMessages: session.messages.slice(-8),
          message,
        });
      store({
        ...session,
        messages: [...session.messages, { role: "You", text: message }],
        pending: { id, requestId: crypto.randomUUID(), content },
      });
      setInput("");
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (active.current) setWorking(false);
    }
  }
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    async function respond(turn: NonNullable<Session["pending"]>) {
      let terminal = false;
      try {
        await ai({ type: "conversation_send", ...turn });
        while (!cancelled) {
          const result = await ai<Reply>({
            type: "conversation_reply",
            id: turn.id,
            requestId: turn.requestId,
          });
          if (cancelled) return;
          if (result.status === "done" || result.status === "unanswered") {
            const answer = result.answer?.model?.find(
              (m) => m.role === "assistant",
            );
            if (result.status === "unanswered" || answer?.errorMessage) {
              terminal = true;
              throw Error(
                answer?.errorMessage ||
                  result.detail ||
                  result.reason ||
                  "The assistant could not finish.",
              );
            }
            const text =
              answer?.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n") ?? "";
            terminal = true;
            const next = await applyLogReply(
              text,
              draft,
              (query) => call<Dish[]>({ type: "dishes_list", query }, "dishes"),
              plans,
            );
            if (!cancelled) {
              onChange(next.draft, next.planId);
              store({
                ...session,
                pending: undefined,
                messages: [
                  ...session.messages,
                  { role: "Assistant", text: next.message },
                ],
              });
            }
            return;
          }
          await new Promise((r) => setTimeout(r, 600));
        }
      } catch (e) {
        if (!cancelled) {
          if (terminal) store({ ...session, pending: undefined });
          setError((e as Error).message);
        }
      }
    }
    void respond(pending);
    return () => {
      cancelled = true;
    };
  }, [pending, retry]);
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pane.current) pane.current.scrollTop = pane.current.scrollHeight;
  }, [session.messages.length]);
  if (hidden) return null;
  return (
    <AssistantPanel
      title="Food logging assistant"
      preference="fit.food-log-chat"
    >
      <section className="dish-chat" aria-label="Food logging assistant">
        <div
          ref={pane}
          className="recipe-messages planning-messages food-log-chat"
        >
          {plans.length > 0 && !selectedPlan && (
            <section className="food-log-plans">
              <h3>Planned for {draft.meal}</h3>
              {plans.map((plan, i) => (
                <button
                  key={i}
                  disabled={busy || disabled}
                  onClick={() =>
                    onChange({ ...draft, items: plan.items }, plan.planId)
                  }
                >
                  <strong>{plan.title}</strong>
                  <small>
                    {plan.items
                      .map((item) => item.name + " × " + item.servings)
                      .join(" · ")}
                  </small>
                </button>
              ))}
            </section>
          )}
          {!session.messages.length && !plans.length && (
            <h3>What did you eat?</h3>
          )}
          {session.messages.map((m, i) => (
            <div className="guided-message" key={i}>
              <strong>{m.role}</strong>
              <p>{m.text}</p>
            </div>
          ))}
          {draft.items.map((item, index) =>
            item.dish ? null : (
              <div className="food-log-item" key={item.name}>
                <div className="food-log-item-title">
                  <strong>{item.name}</strong>
                  <button
                    disabled={busy || disabled}
                    aria-label={"Remove " + item.name}
                    onClick={() =>
                      onChange({
                        ...draft,
                        items: draft.items.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <ActionIcon action="delete" />
                  </button>
                </div>
                {item.matches.length > 0 && (
                  <select
                    disabled={busy || disabled}
                    aria-label={"Match " + item.name}
                    value=""
                    onChange={(e) => {
                      const dish = item.matches.find(
                        (d) => d.id === e.target.value,
                      );
                      if (dish) onChange(selectLogDish(draft, index, dish));
                    }}
                  >
                    <option value="">Choose saved dish</option>
                    {item.matches.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  disabled={busy || disabled}
                  onClick={() => onCreate(index)}
                >
                  Create {item.name}
                </button>
              </div>
            ),
          )}
          <LoadError error={error} />
          {pending && error && (
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
        {busy && !error && <AssistantActivity text="Working on your meal…" />}
        <AssistantComposer
          value={input}
          onChange={setInput}
          onSend={() => void send()}
          disabled={busy || disabled}
          placeholder="Describe what you ate…"
        />
      </section>
    </AssistantPanel>
  );
}
