import { usePreferences } from "./preferences";
import { ActionIcon } from "./ActionIcon";
import { useState } from "react";
import { call, type Shopping as ShoppingData } from "./api";
import {
  Field,
  useAction,
  useLoad,
  LoadError,
  Confirm,
  sunday,
  shift,
  today,
} from "./ui";
export function Shopping({
  revision,
  refresh,
}: {
  revision: number;
  refresh: () => void;
}) {
  const { timezone } = usePreferences();
  const [date, setDate] = useState(() => today(timezone));
  const week = sunday(date);
  const result = useLoad(
    () => call<ShoppingData>({ type: "shopping_list", week }, "shopping"),
    `${week}:${revision}`,
    week,
  );
  const [name, setName] = useState(""),
    [quantity, setQuantity] = useState(""),
    [unit, setUnit] = useState(""),
    [editing, setEditing] = useState("");
  const [removing, setRemoving] = useState<string>();
  const [showChecked, setShowChecked] = useState(false);
  const action = useAction(refresh);
  const reset = () => {
    setName("");
    setQuantity("");
    setUnit("");
    setEditing("");
  };
  const data = result.data;
  const changeWeek = (value: string) => {
    setDate(sunday(value));
    reset();
    setRemoving(undefined);
  };
  const checkedCount = data?.items.filter((item) => item.checked).length ?? 0;
  const remainingCount = (data?.items.length ?? 0) - checkedCount;
  return (
    <section className="shopping-screen">
      <header>
        <div>
          <h1>Shopping</h1>
        </div>
      </header>
      <div className="plan-week-bar" aria-label="Week navigation">
        <p className="plan-week-label">
          {new Date(week + "T12:00:00").toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
          {" – "}
          {new Date(shift(week, 6) + "T12:00:00").toLocaleDateString(
            undefined,
            { month: "short", day: "numeric", year: "numeric" },
          )}
        </p>
        <div className="plan-week-controls">
          <button
            aria-label="Previous week"
            title="Previous week"
            disabled={action.busy}
            onClick={() => changeWeek(shift(week, -7))}
          >
            ←
          </button>
          <input
            type="date"
            aria-label="Week starting"
            title="Week starting Sunday; choose any date to view its week"
            required
            value={week}
            disabled={action.busy}
            onChange={(e) => {
              if (e.target.value) changeWeek(e.target.value);
            }}
          />
          <button
            aria-label="Next week"
            title="Next week"
            disabled={action.busy}
            onClick={() => changeWeek(shift(week, 7))}
          >
            →
          </button>
        </div>
      </div>
      <p className="shopping-intro">
        Ingredients from your meal plans, plus anything else you need.
      </p>
      <LoadError error={result.error || action.error} />
      {!data && <p>Loading shopping list…</p>}
      <form
        className="shopping-add-panel"
        onSubmit={(e) => {
          e.preventDefault();
          action.run(async () => {
            await action.mutate({
              type: editing ? "shopping_edit" : "shopping_add",
              week,
              ...(editing ? { name: editing } : {}),
              item: {
                name: name.trim(),
                quantity: quantity || null,
                unit: unit || null,
              },
            });
            reset();
          });
        }}
      >
        <fieldset disabled={action.busy}>
          <legend>{editing ? "Edit item" : "Add an item"}</legend>
          <div className="shopping-add-fields">
            <Field label="Item name">
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Quantity">
              <input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="2 or a few"
              />
            </Field>
            <Field label="Unit">
              <input value={unit} onChange={(e) => setUnit(e.target.value)} />
            </Field>
            <button className="primary" type="submit">
              {editing ? "Save item" : "Add item"}
            </button>
            {editing && (
              <button type="button" onClick={reset}>
                Cancel edit
              </button>
            )}
          </div>
        </fieldset>
      </form>
      <section className="shopping-list-panel">
        <div className="shopping-list-header">
          <div>
            <h2>Your list</h2>
            {data && (
              <p className="muted">
                {remainingCount} remaining · {checkedCount} checked
              </p>
            )}
          </div>
          <div className="actions">
            <button onClick={() => setShowChecked(!showChecked)}>
              {showChecked ? "Hide" : "Show"} checked (
              {data?.items.filter((i) => i.checked).length ?? 0})
            </button>
            <button
              disabled={action.busy || !data?.cart.checked.length}
              onClick={() => setRemoving("__checked__")}
            >
              Clear checked
            </button>
          </div>
        </div>
        <ul className="shopping-list">
          {data?.items
            .filter((i) => showChecked || !i.checked)
            .map((item, i) => {
              const manual = data.cart.manual_items.find(
                (m) => m.name.toLowerCase() === item.name.toLowerCase(),
              );
              return (
                <li
                  className={item.checked ? "shopping-item-checked" : ""}
                  key={`${item.name}:${item.unit}:${i}`}
                >
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      disabled={action.busy}
                      onChange={() =>
                        action.run(() =>
                          action.mutate({
                            type: "shopping_set_checked",
                            week,
                            name: item.name,
                            checked: !item.checked,
                          }),
                        )
                      }
                    />
                    <span className={item.checked ? "checked" : ""}>
                      {item.name}{" "}
                      <small>
                        {item.is_manual
                          ? `${manual?.quantity ?? ""} ${manual?.unit ?? ""}`
                          : `${Number(item.quantity.toFixed(3))} ${item.unit}`}
                      </small>
                    </span>
                  </label>
                  {item.is_manual && (
                    <div className="actions">
                      <button
                        className="shopping-icon-button"
                        title="Edit item"
                        aria-label={`Edit ${item.name}`}
                        disabled={action.busy}
                        onClick={() => {
                          setEditing(item.name);
                          setName(item.name);
                          setQuantity(manual?.quantity ?? "");
                          setUnit(manual?.unit ?? "");
                        }}
                      >
                        <ActionIcon action="edit" />
                      </button>
                      <button
                        className="shopping-icon-button"
                        title="Remove item"
                        aria-label={`Remove ${item.name}`}
                        disabled={action.busy}
                        onClick={() => setRemoving(item.name)}
                      >
                        <ActionIcon action="delete" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
        </ul>
        {data && !data.items.length && (
          <p className="shopping-empty">
            No items for this week. Add your own items above or plan meals to
            build your list.
          </p>
        )}
        {data &&
          data.items.length > 0 &&
          remainingCount === 0 &&
          !showChecked && (
            <p className="shopping-empty">
              Everything is checked off. Show checked items to review your list.
            </p>
          )}
      </section>
      {removing && (
        <Confirm
          title={
            removing === "__checked__"
              ? "Clear checked items?"
              : `Remove ${removing}?`
          }
          busy={action.busy}
          onCancel={() => setRemoving(undefined)}
          onConfirm={() =>
            action.run(async () => {
              await action.mutate(
                removing === "__checked__"
                  ? { type: "shopping_clear_checked", week }
                  : { type: "shopping_remove", week, name: removing },
              );
              setRemoving(undefined);
            })
          }
        />
      )}
    </section>
  );
}
