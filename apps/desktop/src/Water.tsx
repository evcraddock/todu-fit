import { useEffect, useState } from "react";
import { call, type WaterReport } from "./api";
import {
  Field,
  useLoad,
  useAction,
  LoadError,
  Confirm,
  today,
  shift,
} from "./ui";
const amountLabel = (ml: number, unit: string) =>
  unit === "oz" ? `${(ml / 29.5735).toFixed(1)} oz` : `${Math.round(ml)} mL`;
export function Water({
  revision,
  refresh,
}: {
  revision: number;
  refresh: () => void;
}) {
  const [from, setFrom] = useState(shift(today(), -6)),
    [to, setTo] = useState(today());
  const [customRange, setCustomRange] = useState(false);
  const [amount, setAmount] = useState(""),
    [unit, setUnit] = useState<"ml" | "oz">("ml");
  const [removing, setRemoving] = useState<string>();
  const current = useLoad(
    () => call<WaterReport>({ type: "water_today" }, "water_report"),
    revision,
  );
  const reportDate = current.data?.days[0]?.date;
  useEffect(() => {
    if (reportDate && !customRange) {
      setTo(reportDate);
      setFrom(shift(reportDate, -6));
    }
  }, [reportDate, customRange]);
  const history = useLoad(
    () =>
      call<WaterReport>({ type: "water_history", from, to }, "water_report"),
    `${from}:${to}:${revision}`,
    `${from}:${to}`,
  );
  const action = useAction(refresh);
  const report = current.data,
    display = report?.settings.preferred_unit ?? "ml";
  return (
    <section>
      <header>
        <div>
          <p className="eyebrow">A LITTLE AT A TIME</p>
          <h1>Water</h1>
        </div>
      </header>
      <LoadError error={current.error || history.error || action.error} />
      {report ? (
        <>
          <div className="summary">
            <h2>{amountLabel(report.days[0]?.total_ml ?? 0, display)} today</h2>
            <p>
              Goal: {amountLabel(report.settings.daily_goal_ml, display)} ·{" "}
              {report.settings.timezone}
            </p>
            <progress
              aria-label="Daily water goal"
              max={1}
              value={Math.min(1, report.days[0]?.goal_progress ?? 0)}
            />
            <p>
              {report.streak_days}-day streak · Seven-day average:{" "}
              {amountLabel(report.average_daily_ml_7d, display)}
            </p>
          </div>
          <div className="actions">
            {report.settings.quick_add_presets_ml.map((ml, i) => (
              <button
                key={i}
                disabled={action.busy}
                onClick={() =>
                  action.run(() =>
                    action.mutate({
                      type: "water_add",
                      amount: ml,
                      unit: "ml",
                    }),
                  )
                }
              >
                + {amountLabel(ml, display)}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p>Loading water…</p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action.run(async () => {
            await action.mutate({
              type: "water_add",
              amount: Number(amount),
              unit,
            });
            setAmount("");
          });
        }}
      >
        <fieldset disabled={action.busy}>
          <div className="row">
            <Field label="Water amount">
              <input
                type="number"
                min="0.01"
                step="any"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Water unit">
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as "ml" | "oz")}
              >
                <option value="ml">mL</option>
                <option value="oz">oz</option>
              </select>
            </Field>
            <button type="submit" className="primary">
              Add water
            </button>
          </div>
        </fieldset>
      </form>
      <h2>History</h2>
      <div className="row">
        <Field label="From">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => {
              if (e.target.value) {
                setCustomRange(true);
                setFrom(e.target.value);
              }
            }}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => {
              if (e.target.value) {
                setCustomRange(true);
                setTo(e.target.value);
              }
            }}
          />
        </Field>
      </div>
      <div className="days">
        {history.data?.days.map((d) => (
          <div className="summary" key={d.date}>
            <strong>{d.date}</strong>
            <p>{amountLabel(d.total_ml, display)}</p>
          </div>
        ))}
      </div>
      <ul className="shopping-list">
        {history.data?.entries
          .slice()
          .reverse()
          .map((entry) => (
            <li key={entry.id}>
              <span>
                {new Date(entry.consumed_at).toLocaleString(undefined, {
                  timeZone: report?.settings.timezone,
                })}{" "}
                · {amountLabel(entry.amount_ml, display)}
              </span>
              <button
                disabled={action.busy}
                onClick={() => setRemoving(entry.id)}
              >
                Delete water entry
              </button>
            </li>
          ))}
      </ul>
      {removing && (
        <Confirm
          title="Delete water entry?"
          busy={action.busy}
          onCancel={() => setRemoving(undefined)}
          onConfirm={() =>
            action.run(async () => {
              await action.mutate({ type: "water_delete", id: removing });
              setRemoving(undefined);
            })
          }
        />
      )}
    </section>
  );
}
