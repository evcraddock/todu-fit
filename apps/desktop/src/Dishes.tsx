import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { call, type Dish, type Ingredient, type Nutrient } from "./api";
import {
  Field,
  useAction,
  useLoad,
  Confirm,
  Nutrition,
  dishNutrition,
  LoadError,
} from "./ui";
import { Markdown } from "./Markdown";
import { DishAssistant, type Draft } from "./DishAssistant";
export const DishScope = createContext<string | undefined>(undefined);
export function Dishes({
  revision,
  refresh,
  initialDish,
  onBack,
  backLabel = "Back to day",
}: {
  initialDish?: Dish;
  onBack?: () => void;
  backLabel?: string;
  revision: number;
  refresh: () => void;
}) {
  const assistantScope = useContext(DishScope);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Dish | undefined>(initialDish);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<Dish>();
  const loaded = useLoad(
    () =>
      selected
        ? call<Dish>(
            { type: "dish_get", identifier: selected.id },
            "dish",
          ).then((dish) => [dish])
        : call<Dish[]>({ type: "dishes_list" }, "dishes"),
    revision,
    selected?.id ?? "",
    !editing,
  );
  const dishes = loaded.data ?? [];
  const action = useAction(refresh);
  const requiredTags = tagFilter
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  const filtered = dishes
    .filter(
      (d) =>
        requiredTags.every((tag) =>
          d.tags.some((dishTag) => dishTag.trim().toLowerCase() === tag),
        ) && d.name.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    );
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const visibleDishes = filtered.slice(pageStart, pageStart + pageSize);
  useEffect(() => {
    setPage((previous) => Math.min(previous, pageCount));
  }, [pageCount]);
  if (editing)
    return (
      <DishEditor
        groupScope={assistantScope}
        onOpenDish={(d) => {
          setSelected(d);
          setEditing(false);
        }}
        dish={selected}
        onCancel={() => setEditing(false)}
        onSaved={(d) => {
          setSelected(d);
          setEditing(false);
          refresh();
        }}
      />
    );
  if (loaded.error)
    return (
      <section>
        {onBack && <button onClick={onBack}>← {backLabel}</button>}
        <LoadError error={loaded.error} />
      </section>
    );
  if (!loaded.data) return <p>Loading dishes…</p>;
  if (selected) {
    const d = dishes.find((d) => d.id === selected.id) ?? selected;
    return (
      <section>
        <button onClick={() => (onBack ? onBack() : setSelected(undefined))}>
          {onBack ? `← ${backLabel}` : "← All dishes"}
        </button>
        <header>
          <h1>{d.name}</h1>
          <div className="actions">
            <button
              onClick={() => {
                setSelected(d);
                setEditing(true);
              }}
            >
              Edit dish
            </button>
            <button className="danger" onClick={() => setDeleting(d)}>
              Delete dish
            </button>
          </div>
        </header>
        <LoadError error={action.error} />
        <p>{d.tags.join(" · ")}</p>
        <p>
          Prep: {d.prep_time ?? "—"} min · Cook: {d.cook_time ?? "—"} min ·
          Servings: {d.servings ?? "—"}
        </p>
        <Nutrition values={dishNutrition([d])} />
        <h2>Ingredients</h2>
        <ul>
          {d.ingredients.map((i, n) => (
            <li key={n}>
              {i.quantity} {i.unit} {i.name}
            </li>
          ))}
        </ul>
        <h2>Instructions</h2>
        <Markdown>{d.instructions || "No instructions yet."}</Markdown>
        {d.source_url && (
          <p>
            Source:{" "}
            <a href={d.source_url} target="_blank" rel="noopener noreferrer">
              {d.source_url}
            </a>
          </p>
        )}
        {deleting && (
          <Confirm
            title={`Delete ${deleting.name}?`}
            busy={action.busy}
            onCancel={() => setDeleting(undefined)}
            onConfirm={() =>
              action.run(async () => {
                await action.mutate({
                  type: "dish_delete",
                  identifier: deleting.id,
                });
                setDeleting(undefined);
                setSelected(undefined);
                onBack?.();
              })
            }
          />
        )}
      </section>
    );
  }
  return (
    <section className="dish-list">
      <header>
        <div>
          <h1>Dishes</h1>
        </div>
        <button
          className="primary"
          onClick={() => {
            setSelected(undefined);
            setEditing(true);
          }}
        >
          New dish
        </button>
      </header>
      <div className="row">
        <Field label="Search by name">
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="Tags">
          <input
            type="text"
            placeholder="e.g. chicken, dinner"
            title="Matches dishes with all entered tags"
            value={tagFilter}
            onChange={(e) => {
              setTagFilter(e.target.value);
              setPage(1);
            }}
          />
        </Field>
      </div>
      {filtered.length > 0 && (
        <div
          className="dish-pagination"
          role="group"
          aria-label="Dish pagination"
        >
          <span role="status">
            Showing {pageStart + 1}–{pageStart + visibleDishes.length} of{" "}
            {filtered.length} dishes
          </span>
          <div className="dish-page-controls">
            <button
              disabled={currentPage === 1}
              onClick={() => {
                setPage(currentPage - 1);
              }}
            >
              Previous
            </button>
            <span>
              Page {currentPage} of {pageCount}
            </span>
            <button
              disabled={currentPage === pageCount}
              onClick={() => {
                setPage(currentPage + 1);
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
      <div className="cards">
        {visibleDishes.map((d) => (
          <div className="card" key={d.id} data-dish-id={d.id}>
            <h2>
              <button
                className="dish-card-open"
                title={d.name}
                onClick={() => {
                  setSelected(d);
                }}
              >
                {d.name}
              </button>
            </h2>
            <div className="dish-card-tags">
              {d.tags.length
                ? d.tags.slice(0, 3).map((tag, index) => (
                    <span key={`${tag}:${index}`}>
                      {index > 0 && <span aria-hidden="true"> · </span>}
                      <button
                        className="dish-tag"
                        aria-label={`Filter by tag: ${tag}`}
                        onClick={() => {
                          if (
                            !requiredTags.includes(tag.trim().toLowerCase())
                          ) {
                            setTagFilter(
                              [
                                ...tagFilter
                                  .split(",")
                                  .map((value) => value.trim())
                                  .filter(Boolean),
                                tag,
                              ].join(", "),
                            );
                          }
                          setPage(1);
                        }}
                      >
                        {tag}
                      </button>
                    </span>
                  ))
                : null}
            </div>
          </div>
        ))}
      </div>
      {!filtered.length && <p>No dishes found. Add a recipe to get started.</p>}
    </section>
  );
}
// Fields and nutrient/ingredient editor follow web/src/dishes/DishForm.
function DishEditor({
  groupScope,
  onOpenDish,
  dish,
  onSaved,
  onCancel,
}: {
  groupScope?: string;
  onOpenDish: (dish: Dish) => void;
  dish?: Dish;
  onSaved: (d: Dish) => void;
  onCancel: () => void;
}) {
  const scope =
    groupScope && (dish ? JSON.stringify([groupScope, dish.id]) : groupScope);
  const chatKey = scope && "fit.dish-assistant.v1." + scope;
  const formKey = scope && "fit.new-dish.v1." + scope;
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("fit.dish-chat.collapsed") === "true",
  );
  const [chatActions, setChatActions] = useState<HTMLDivElement | null>(null);
  const [panelWidth, setPanelWidth] = useState(
    () => Number(localStorage.getItem("fit.dish-chat.width")) || 350,
  );
  function resizePanel(width: number, handle: HTMLElement) {
    const main = handle.closest(".app")?.querySelector("main");
    const limit = Math.max(
      200,
      window.innerWidth - (main?.getBoundingClientRect().left ?? 0) - 320,
    );
    const next = Math.round(Math.min(limit, Math.max(200, width)));
    setPanelWidth(next);
    localStorage.setItem("fit.dish-chat.width", String(next));
  }
  const [initial] = useState<Partial<Dish> | undefined>(
    () =>
      (formKey && JSON.parse(localStorage.getItem(formKey) || "null")) ??
      dish ??
      (chatKey && JSON.parse(localStorage.getItem(chatKey) || "{}").draft),
  );
  const [waiting, setWaiting] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [tags, setTags] = useState(initial?.tags?.join(", ") ?? "");
  const [prep, setPrep] = useState(String(initial?.prep_time ?? ""));
  const [cook, setCook] = useState(String(initial?.cook_time ?? ""));
  const [servings, setServings] = useState(String(initial?.servings ?? ""));
  const [source, setSource] = useState(initial?.source_url ?? "");
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    initial?.ingredients ?? [],
  );
  const [nutrients, setNutrients] = useState<Nutrient[]>(
    initial?.nutrients ?? [],
  );
  const [preview, setPreview] = useState(false);
  const action = useAction(() => {});
  useEffect(() => {
    if (formKey)
      localStorage.setItem(
        formKey,
        JSON.stringify({
          name,
          instructions,
          servings: servings || null,
          prep_time: prep,
          cook_time: cook,
          source_url: source,
          ingredients,
          nutrients,
          tags: tags.split(",").map((t) => t.trim()),
        }),
      );
  }, [
    formKey,
    name,
    instructions,
    servings,
    prep,
    cook,
    source,
    ingredients,
    nutrients,
    tags,
  ]);
  const draft: Draft = {
    name,
    instructions,
    servings: servings ? Number(servings) : null,
    prep_time: prep === "" ? null : Number(prep),
    cook_time: cook === "" ? null : Number(cook),
    nutrients,
    ingredients,
  };
  function applyDraft(next: Draft) {
    setName(next.name);
    setInstructions(next.instructions);
    setServings(String(next.servings ?? ""));
    setIngredients(next.ingredients);
    if (next.prep_time !== undefined) setPrep(String(next.prep_time ?? ""));
    if (next.cook_time !== undefined) setCook(String(next.cook_time ?? ""));
    if (next.nutrients !== undefined) setNutrients(next.nutrients);
  }
  function clearDraft(savedId?: string) {
    if (!dish && chatKey) {
      const session = localStorage.getItem(chatKey);
      if (savedId && session) {
        const savedScope = JSON.stringify([groupScope, savedId]);
        localStorage.setItem("fit.dish-assistant.v1." + savedScope, session);
      }
      localStorage.removeItem(chatKey);
    }
    if (formKey) localStorage.removeItem(formKey);
  }
  const updateIngredient = (index: number, patch: Partial<Ingredient>) =>
    setIngredients(
      ingredients.map((i, n) => (n === index ? { ...i, ...patch } : i)),
    );
  return (
    <section className={chatKey ? "dish-editor dish-with-chat" : "dish-editor"}>
      <header className="editor-header">
        <div>
          <h1>{dish?.name || "New dish"}</h1>
        </div>
        <div className="editor-header-actions">
          <button
            type="button"
            disabled={action.busy || waiting}
            onClick={() => {
              clearDraft();
              onCancel();
            }}
          >
            Cancel
          </button>
          <button
            className="primary"
            type="submit"
            form="dish-editor-form"
            disabled={action.busy || waiting}
          >
            {action.busy ? "Saving…" : "Save dish"}
          </button>
        </div>
      </header>
      <LoadError error={action.error} />
      <div className={chatKey ? "dish-compose" : undefined}>
        <form
          id="dish-editor-form"
          onSubmit={(e) => {
            e.preventDefault();
            action.run(async () => {
              const parsedTags = tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean);
              const fields = {
                instructions,
                clear_prep_time: prep === "",
                clear_cook_time: cook === "",
                clear_servings: servings === "",
                prep_time: prep === "" ? undefined : Number(prep),
                cook_time: cook === "" ? undefined : Number(cook),
                servings: servings === "" ? undefined : Number(servings),
                source_url: source,
                ingredients,
                nutrients,
                add_tags: parsedTags,
                remove_tags: (dish?.tags ?? []).filter(
                  (t) => !parsedTags.includes(t),
                ),
              };
              const saved = await action.call<Dish>(
                dish
                  ? { type: "dish_update", identifier: dish.id, name, fields }
                  : { type: "dish_create", name, fields },
                "dish",
              );
              clearDraft(saved.id);
              onSaved(saved);
            });
          }}
        >
          <fieldset className="editor-layout" disabled={action.busy || waiting}>
            <div className="editor-main">
              <section className="editor-panel">
                <h2>Recipe details</h2>
                <Field label="Dish name">
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <div className="row">
                  <Field label="Prep time (min)">
                    <input
                      type="number"
                      min="0"
                      value={prep}
                      onChange={(e) => setPrep(e.target.value)}
                    />
                  </Field>
                  <Field label="Cook time (min)">
                    <input
                      type="number"
                      min="0"
                      value={cook}
                      onChange={(e) => setCook(e.target.value)}
                    />
                  </Field>
                  <Field label="Servings">
                    <input
                      type="number"
                      min="1"
                      value={servings}
                      onChange={(e) => setServings(e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Tags (comma-separated)">
                  <input
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                  />
                </Field>
              </section>
              <section className="editor-panel editor-instructions">
                <h2>Instructions & source</h2>
                <Field label="Instructions (Markdown)">
                  <textarea
                    rows={8}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                  />
                </Field>
                <button
                  className="editor-preview-toggle"
                  type="button"
                  aria-expanded={preview}
                  onClick={() => setPreview(!preview)}
                >
                  {preview ? "Hide preview" : "Preview instructions"}
                </button>
                {preview && (
                  <div className="editor-preview">
                    <Markdown>{instructions}</Markdown>
                  </div>
                )}
                <Field label="Source URL">
                  <input
                    type="url"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  />
                </Field>
              </section>
            </div>
            <div className="editor-sidebar">
              <section className="editor-panel editor-nutrition">
                <h2>Nutrition</h2>
                <p className="editor-section-note">Amounts per serving</p>
                <div className="editor-table-heading" aria-hidden="true">
                  <span>Nutrient</span>
                  <span>Amount</span>
                  <span>Unit</span>
                  <span />
                </div>
                {nutrients.map((n, i) => (
                  <div className="editor-table-row" key={i}>
                    <Field label="Nutrient">
                      <input
                        required
                        value={n.name}
                        onChange={(e) =>
                          setNutrients(
                            nutrients.map((v, j) =>
                              i === j ? { ...v, name: e.target.value } : v,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Amount">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        required
                        value={n.amount}
                        onChange={(e) =>
                          setNutrients(
                            nutrients.map((v, j) =>
                              i === j
                                ? { ...v, amount: Number(e.target.value) }
                                : v,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Unit">
                      <input
                        required
                        value={n.unit}
                        onChange={(e) =>
                          setNutrients(
                            nutrients.map((v, j) =>
                              i === j ? { ...v, unit: e.target.value } : v,
                            ),
                          )
                        }
                      />
                    </Field>
                    <button
                      className="editor-remove"
                      aria-label="Remove nutrient"
                      title={`Remove ${n.name || "nutrient"}`}
                      type="button"
                      onClick={() =>
                        setNutrients(nutrients.filter((_, j) => i !== j))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  className="editor-add"
                  type="button"
                  onClick={() =>
                    setNutrients([
                      ...nutrients,
                      { name: "calories", amount: 0, unit: "kcal" },
                    ])
                  }
                >
                  Add nutrient
                </button>
              </section>
              <section className="editor-panel editor-ingredients">
                <h2>Ingredients</h2>
                <div className="editor-ingredient-rows">
                  <div className="editor-table-heading" aria-hidden="true">
                    <span>Ingredient</span>
                    <span>Quantity</span>
                    <span>Unit</span>
                    <span />
                  </div>
                  {ingredients.map((n, i) => (
                    <div className="editor-table-row" key={i}>
                      <Field label="Ingredient">
                        <input
                          required
                          value={n.name}
                          onChange={(e) =>
                            updateIngredient(i, { name: e.target.value })
                          }
                        />
                      </Field>
                      <Field label="Quantity">
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          required
                          value={n.quantity}
                          onChange={(e) =>
                            updateIngredient(i, {
                              quantity: Number(e.target.value),
                            })
                          }
                        />
                      </Field>
                      <Field label="Unit">
                        <input
                          value={n.unit}
                          onChange={(e) =>
                            updateIngredient(i, { unit: e.target.value })
                          }
                        />
                      </Field>
                      <button
                        className="editor-remove"
                        aria-label="Remove ingredient"
                        title={`Remove ${n.name || "ingredient"}`}
                        type="button"
                        onClick={() =>
                          setIngredients(ingredients.filter((_, j) => i !== j))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="editor-add"
                  type="button"
                  onClick={() =>
                    setIngredients([
                      ...ingredients,
                      { name: "", quantity: 1, unit: "" },
                    ])
                  }
                >
                  Add ingredient
                </button>
              </section>
            </div>
          </fieldset>
        </form>
        {chatKey &&
          createPortal(
            <div
              id="dish-assistant-panel"
              data-collapsed={collapsed}
              style={{ width: collapsed ? 40 : panelWidth }}
            >
              {!collapsed && (
                <div
                  className="dish-chat-divider"
                  role="separator"
                  tabIndex={0}
                  aria-label="Resize dish assistant"
                  aria-orientation="vertical"
                  aria-valuenow={panelWidth}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId))
                      resizePanel(
                        window.innerWidth - e.clientX,
                        e.currentTarget,
                      );
                  }}
                  onPointerUp={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId))
                      e.currentTarget.releasePointerCapture(e.pointerId);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                      e.preventDefault();
                      resizePanel(
                        (e.currentTarget.parentElement?.clientWidth ??
                          panelWidth) + (e.key === "ArrowLeft" ? 16 : -16),
                        e.currentTarget,
                      );
                    }
                  }}
                />
              )}
              <div className="dish-chat-header">
              <button
                className="dish-chat-toggle"
                type="button"
                aria-expanded={!collapsed}
                aria-controls="dish-chat-body"
                onClick={() => {
                  setCollapsed(!collapsed);
                  localStorage.setItem(
                    "fit.dish-chat.collapsed",
                    String(!collapsed),
                  );
                }}
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d={collapsed ? "m10 3-5 5 5 5" : "m6 3 5 5-5 5"} />
                </svg>
                <span>Dish assistant</span>
              </button>
                <div ref={setChatActions} hidden={collapsed} />
              </div>
              <div id="dish-chat-body" hidden={collapsed}>
                <DishAssistant
                  storageKey={chatKey}
                  headerActions={chatActions}
                  onOpenDish={onOpenDish}
                  draft={draft}
                  onDraft={applyDraft}
                  placeholder={
                    dish
                      ? "Would you like to make any changes?"
                      : "What kind of dish did you have in mind?"
                  }
                  onWaiting={setWaiting}
                  disabled={action.busy}
                />
              </div>
            </div>,
            document.querySelector(".app")!,
          )}
      </div>
    </section>
  );
}
