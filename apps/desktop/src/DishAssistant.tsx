import { AssistantComposer } from "./AssistantComposer";
import { AssistantActivity } from "./AssistantActivity";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { call, type Dish, type Nutrient, type Operation } from "./api";
import { Confirm, LoadError } from "./ui";
import { Markdown } from "./Markdown";

export type Draft = Pick<
  Dish,
  "name" | "servings" | "instructions" | "ingredients"
> &
  Partial<Pick<Dish, "prep_time" | "cook_time">> & { nutrients?: Nutrient[] };
type DishMatch = Pick<Dish, "id" | "name">;
type Session = {
  conversation?: number;
  dishPrompt?: number | boolean;
  model?: { provider: string; modelId: string };
  messages: { role: string; text: string; dishes?: DishMatch[] }[];
  draft?: Draft;
  pending?: { id: string; content: string; submitted: boolean };
};
const fresh = (): Session => ({
  messages: [],
});
async function ai<T>(op: Operation): Promise<T> {
  const r = await window.fit.assistant(op);
  if (!r.ok) throw Error(r.error);
  return r.value as T;
}
type ReplyStatus = {
  status: "queued" | "placed" | "unanswered" | "done";
  reason?: string;
  detail?: string;
  answer?: {
    model?: {
      role: string;
      content: { type: string; text?: string }[];
      errorMessage?: string;
    }[];
  };
};
function authFailure(text: string) {
  return /invalid x-api-key|invalid.api.key|^401\b|authentication_error/i.test(
    text,
  );
}
function reply(text: string): {
  message: string;
  draft?: Draft;
  search?: string;
} {
  const match = text
    .trim()
    .match(/^(?:```(?:json)?\s*)?(\{[\s\S]*\})(?:\s*```)?$/i);
  if (!match) return { message: text };
  try {
    const value = JSON.parse(match[1]),
      d = value.draft;
    if (typeof value.searchDishes === "string" && value.searchDishes.trim())
      return { message: "", search: value.searchDishes.trim().slice(0, 200) };
    if (typeof value.message !== "string") throw Error();
    if (!d) return { message: value.message };
    if (
      typeof d.name !== "string" ||
      typeof d.instructions !== "string" ||
      !Number.isInteger(d.servings) ||
      d.servings < 1 ||
      [d.prep_time, d.cook_time].some(
        (t) => t != null && (!Number.isInteger(t) || t < 0),
      ) ||
      (d.nutrients !== undefined &&
        (!Array.isArray(d.nutrients) ||
          !d.nutrients.every(
            (n: Nutrient) =>
              n &&
              typeof n.name === "string" &&
              typeof n.unit === "string" &&
              Number.isFinite(n.amount) &&
              n.amount >= 0,
          ))) ||
      !Array.isArray(d.ingredients) ||
      !d.ingredients.every(
        (i: Draft["ingredients"][number]) =>
          i &&
          typeof i.name === "string" &&
          Number.isFinite(i.quantity) &&
          i.quantity >= 0 &&
          typeof i.unit === "string",
      )
    )
      throw Error();
    return {
      message: value.message,
      draft: {
        name: d.name,
        instructions: d.instructions,
        servings: d.servings,
        ingredients: d.ingredients,
        prep_time: d.prep_time,
        cook_time: d.cook_time,
        nutrients: d.nutrients,
      },
    };
  } catch {
    return {
      message: "I couldn't read the recipe draft. Ask me to generate it again.",
    };
  }
}
export function DishAssistant({
  storageKey: key,
  initialRequest,
  headerActions,
  draft,
  onDraft,
  onWaiting,
  onOpenDish,
  placeholder,
  disabled,
}: {
  storageKey: string;
  initialRequest?: string;
  headerActions: HTMLElement | null;
  draft: Draft;
  onDraft: (draft: Draft) => void;
  onWaiting: (busy: boolean) => void;
  onOpenDish: (dish: Dish) => void;
  placeholder: string;
  disabled: boolean;
}) {
  const [s, set] = useState<Session>(
    () => JSON.parse(localStorage.getItem(key) || "null") ?? fresh(),
  );
  const current = useRef(s);
  function store(next: Session) {
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      setError("The conversation could not be cached on this computer.");
    }
    current.current = next;
    set(next);
  }
  const [input, setInput] = useState(initialRequest ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [paused, pause] = useState(false);
  useEffect(() => onWaiting(busy || !!s.pending), [busy, s.pending, onWaiting]);
  useEffect(() => {
    if (!s.pending || !s.conversation) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const id = s.conversation,
      pending = s.pending;
    async function poll() {
      try {
        if (!current.current.pending?.submitted) {
          await ai({
            type: "conversation_send",
            id,
            requestId: pending.id,
            content: pending.content,
          });
          if (!active) return;
          store({
            ...current.current,
            pending: { ...pending, submitted: true },
          });
        }
        const result = await ai<ReplyStatus>({
          type: "conversation_reply",
          id,
          requestId: pending.id,
        });
        if (!active) return;
        if (result.status === "done" || result.status === "unanswered") {
          const answer = result.answer?.model?.find(
            (m) => m.role === "assistant",
          );
          const failure =
            typeof result.detail === "string" ? result.detail : result.reason;
          const response = reply(
            answer?.errorMessage ||
              answer?.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n") ||
              (failure
                ? `Message failed: ${failure}`
                : "The assistant returned an empty response."),
          );
          let dishes: DishMatch[] | undefined;
          if (response.search) {
            const query = response.search;
            const found = await call<Dish[]>(
              { type: "dishes_list", query },
              "dishes",
            );
            if (!active) return;
            const matches = found
              .filter((dish) =>
                dish.name.toLowerCase().includes(query.toLowerCase()),
              )
              .sort((a, b) => a.name.localeCompare(b.name));
            dishes = matches.slice(0, 12).map(({ id, name }) => ({ id, name }));
            response.message =
              matches.length === 0
                ? `No saved dish names match “${query}”.`
                : `Found ${matches.length} saved ${matches.length === 1 ? "dish" : "dishes"} matching “${query}”.${matches.length > 12 ? " Showing the first 12." : ""}`;
          }
          if (response.draft) onDraft(response.draft);
          store({
            ...current.current,
            pending: undefined,
            draft: response.draft ?? current.current.draft,
            messages: [
              ...current.current.messages,
              { role: "Assistant", text: response.message, dishes },
            ],
          });
          return;
        }
        timer = setTimeout(poll, 900);
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          pause(true);
        }
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [s.pending?.id, s.conversation, retry]);
  async function send(message = input) {
    if (!message.trim() || busy || s.pending) return;
    setBusy(true);
    setError("");
    try {
      const { model } = await ai<{ model: Session["model"] }>({
        type: "settings",
      });
      if (!model)
        throw Error(
          "Choose a model in Settings → AI before sending a message.",
        );
      const reuse =
        s.dishPrompt === 2 &&
        s.conversation &&
        s.model?.provider === model.provider &&
        s.model.modelId === model.modelId;
      const id = reuse
        ? s.conversation!
        : (
            await ai<{ id: number }>({
              type: "dish_conversation_create",
              model,
            })
          ).id;
      const content = JSON.stringify({
        recentSearchResults: s.messages
          .filter((m) => m.dishes)
          .at(-1)
          ?.dishes?.map((d) => d.name),
        message: message.trim(),
        draft,
        ...(!reuse && s.messages.length
          ? {
              previousMessages: s.messages
                .filter((m) => !authFailure(m.text))
                .slice(-12)
                .map((m) => ({ ...m, text: m.text.slice(0, 1500) })),
            }
          : {}),
      });
      store({
        ...s,
        conversation: id,
        dishPrompt: 2,
        model,
        messages: [...s.messages, { role: "You", text: message.trim() }],
        pending: { id: crypto.randomUUID(), content, submitted: false },
      });
      setInput("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="dish-chat" aria-label="Dish assistant">
      {headerActions &&
        createPortal(
          <button
            type="button"
            className="dish-chat-clear"
            disabled={
              !s.messages.length || disabled || busy || (!!s.pending && !paused)
            }
            onClick={() => setConfirmClear(true)}
          >
            Clear conversation
          </button>,
          headerActions,
        )}
      {confirmClear && (
        <Confirm
          title="Clear this dish conversation?"
          busy={false}
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            localStorage.removeItem(key);
            const next = fresh();
            current.current = next;
            set(next);
            setInput("");
            setError("");
            pause(false);
            setConfirmClear(false);
          }}
        />
      )}
      <LoadError error={error} />
      <div className="recipe-messages" role="log">
        {s.messages.map((m, i) => (
          <div key={i}>
            <strong>
              {m.role === "Assistant" && authFailure(m.text)
                ? "Connection error"
                : m.role}
            </strong>
            <Markdown>
              {m.role === "Assistant" && authFailure(m.text)
                ? "The provider rejected its credentials. Reconnect it in Settings → AI or choose another model."
                : m.text}
            </Markdown>
            {m.dishes?.map((dish) => (
              <button
                type="button"
                className="dish-chat-match"
                key={dish.id}
                onClick={async () => {
                  try {
                    const saved = await call<Dish>(
                      { type: "dish_get", identifier: dish.id },
                      "dish",
                    );
                    onOpenDish(saved);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {dish.name}
              </button>
            ))}
            {i === s.messages.length - 1 &&
              m.role === "Assistant" &&
              authFailure(m.text) &&
              s.messages[i - 1]?.role === "You" && (
                <button
                  type="button"
                  disabled={busy || !!s.pending || disabled}
                  onClick={() => void send(s.messages[i - 1].text)}
                >
                  Retry with selected model
                </button>
              )}
          </div>
        ))}
      </div>
      {(busy || s.pending) && !paused && !error && (
        <AssistantActivity text="Working on your recipe…" />
      )}
      {paused && <p role="status">Waiting to reconnect</p>}
      {paused && (
        <button
          onClick={() => {
            pause(false);
            setError("");
            setRetry((n) => n + 1);
          }}
        >
          Retry
        </button>
      )}
      <AssistantComposer
        value={input}
        onChange={setInput}
        placeholder={placeholder}
        disabled={disabled || busy || !!s.pending}
        onSend={() => void send()}
      />
    </section>
  );
}
