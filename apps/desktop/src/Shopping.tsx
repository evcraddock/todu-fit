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
  const [date, setDate] = useState(today());
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
  return (
    <section>
      <header>
        <div>
          <p className="eyebrow">PLAN TO PANTRY</p>
          <h1>Shopping</h1>
        </div>
        <Field label="Week containing">
          <input
            type="date"
            required
            value={date}
            onChange={(e) => {
              if (e.target.value) {
                setDate(e.target.value);
                reset();
              }
            }}
          />
        </Field>
      </header>
      <p>
        {week} – {shift(week, 6)} · Ingredients from your meal plans plus your
        own items.
      </p>
      <LoadError error={result.error || action.error} />
      {!data && <p>Loading shopping list…</p>}
      <form
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
          <div className="row">
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
      <ul className="shopping-list">
        {data?.items
          .filter((i) => showChecked || !i.checked)
          .map((item, i) => {
            const manual = data.cart.manual_items.find(
              (m) => m.name.toLowerCase() === item.name.toLowerCase(),
            );
            return (
              <li key={`${item.name}:${item.unit}:${i}`}>
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
                      disabled={action.busy}
                      onClick={() => {
                        setEditing(item.name);
                        setName(item.name);
                        setQuantity(manual?.quantity ?? "");
                        setUnit(manual?.unit ?? "");
                      }}
                    >
                      Edit item
                    </button>
                    <button
                      disabled={action.busy}
                      onClick={() => setRemoving(item.name)}
                    >
                      Remove item
                    </button>
                  </div>
                )}
              </li>
            );
          })}
      </ul>
      {data && !data.items.length && <p>Your list is empty.</p>}
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
