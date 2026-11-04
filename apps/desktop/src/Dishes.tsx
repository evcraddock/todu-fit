import { useState } from "react";
import { type Dish, type Ingredient, type Nutrient } from "./api";
import {
  Field,
  useAction,
  Confirm,
  Nutrition,
  dishNutrition,
  LoadError,
} from "./ui";
import { Markdown } from "./Markdown";
export function Dishes({
  dishes,
  refresh,
}: {
  dishes: Dish[];
  refresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [selected, setSelected] = useState<Dish>();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<Dish>();
  const action = useAction(refresh);
  if (editing)
    return (
      <DishEditor
        dish={selected}
        onCancel={() => setEditing(false)}
        onSaved={(d) => {
          setSelected(d);
          setEditing(false);
          refresh();
        }}
      />
    );
  if (selected) {
    const d = dishes.find((d) => d.id === selected.id) ?? selected;
    return (
      <section>
        <button onClick={() => setSelected(undefined)}>← All dishes</button>
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
        {d.source_url && <p>Source: {d.source_url}</p>}
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
              })
            }
          />
        )}
      </section>
    );
  }
  const filtered = dishes.filter(
    (d) =>
      (!tag || d.tags.includes(tag)) &&
      d.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section>
      <header>
        <div>
          <p className="eyebrow">YOUR RECIPES</p>
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
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <Field label="Tag">
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">All tags</option>
            {[...new Set(dishes.flatMap((d) => d.tags))].sort().map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="cards">
        {filtered.map((d) => (
          <button
            className="card"
            key={d.id}
            data-dish-id={d.id}
            onClick={() => setSelected(d)}
          >
            <h2>{d.name}</h2>
            <p>{d.tags.join(" · ") || "Recipe"}</p>
            <Nutrition values={dishNutrition([d])} />
          </button>
        ))}
      </div>
      {!filtered.length && <p>No dishes found. Add a recipe to get started.</p>}
    </section>
  );
}
// Fields and nutrient/ingredient editor follow web/src/dishes/DishForm.
function DishEditor({
  dish,
  onSaved,
  onCancel,
}: {
  dish?: Dish;
  onSaved: (d: Dish) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(dish?.name ?? "");
  const [instructions, setInstructions] = useState(dish?.instructions ?? "");
  const [tags, setTags] = useState(dish?.tags.join(", ") ?? "");
  const [prep, setPrep] = useState(String(dish?.prep_time ?? ""));
  const [cook, setCook] = useState(String(dish?.cook_time ?? ""));
  const [servings, setServings] = useState(String(dish?.servings ?? ""));
  const [source, setSource] = useState(dish?.source_url ?? "");
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    dish?.ingredients ?? [],
  );
  const [nutrients, setNutrients] = useState<Nutrient[]>(dish?.nutrients ?? []);
  const [preview, setPreview] = useState(false);
  const action = useAction(() => {});
  const updateIngredient = (index: number, patch: Partial<Ingredient>) =>
    setIngredients(
      ingredients.map((i, n) => (n === index ? { ...i, ...patch } : i)),
    );
  return (
    <section>
      <h1>{dish ? "Edit dish" : "New dish"}</h1>
      <LoadError error={action.error} />
      <form
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
            onSaved(saved);
          });
        }}
      >
        <fieldset disabled={action.busy}>
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
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <fieldset>
            <legend>Nutrition per serving</legend>
            {nutrients.map((n, i) => (
              <div className="row" key={i}>
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
                  type="button"
                  onClick={() =>
                    setNutrients(nutrients.filter((_, j) => i !== j))
                  }
                >
                  Remove nutrient
                </button>
              </div>
            ))}
            <button
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
          </fieldset>
          <fieldset>
            <legend>Ingredients</legend>
            {ingredients.map((n, i) => (
              <div className="row" key={i}>
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
                      updateIngredient(i, { quantity: Number(e.target.value) })
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
                  type="button"
                  onClick={() =>
                    setIngredients(ingredients.filter((_, j) => i !== j))
                  }
                >
                  Remove ingredient
                </button>
              </div>
            ))}
            <button
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
          </fieldset>
          <Field label="Instructions (Markdown)">
            <textarea
              rows={7}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </Field>
          <button type="button" onClick={() => setPreview(!preview)}>
            Toggle preview
          </button>
          {preview && <Markdown>{instructions}</Markdown>}
          <Field label="Source URL">
            <input
              type="url"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </Field>
          <div className="actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button className="primary" type="submit">
              {action.busy ? "Saving…" : "Save dish"}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
