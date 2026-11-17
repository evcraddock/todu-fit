import { usePreferences } from "./preferences";
import { ActionIcon } from "./ActionIcon";
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
  sunday,
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
  const { timezone } = usePreferences();
  const [from, setFrom] = useState(() => sunday(today(timezone)));
  const to = shift(from, 6);
  const [customWeek, setCustomWeek] = useState(false);
  const changeWeek = (date: string) => {
    setCustomWeek(true);
    setFrom(sunday(date));
  };
  const [amount, setAmount] = useState(""),
    [unit, setUnit] = useState<"ml" | "oz">("ml");
  const [removing, setRemoving] = useState<string>();
  const current = useLoad(
    () => call<WaterReport>({ type: "water_today" }, "water_report"),
    revision,
  );
  const preferredUnit = current.data?.settings.preferred_unit;
  useEffect(() => {
    if (preferredUnit) setUnit(preferredUnit);
  }, [preferredUnit]);
  const reportDate = current.data?.days[0]?.date;
  useEffect(() => {
    if (reportDate && !customWeek) setFrom(sunday(reportDate));
  }, [reportDate, customWeek]);
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
    <section className="water-screen">
      <header>
        <div>
          <h1>Water</h1>
        </div>
      </header>
      <LoadError error={current.error || history.error || action.error} />
      <div className="water-overview">
        <section className="water-panel water-today">
          {report ? (
            <>
              <div>
                <h2>
                  {amountLabel(report.days[0]?.total_ml ?? 0, display)} today
                </h2>
                <p>
                  Goal: {amountLabel(report.settings.daily_goal_ml, display)} ·{" "}
                  {report.settings.timezone}
                </p>
                <progress
                  aria-label="Daily water goal"
                  max={1}
                  value={Math.min(1, report.days[0]?.goal_progress ?? 0)}
                />
                <div className="water-stats">
                  <div>
                    <span>Current streak</span>
                    <strong>{report.streak_days} days</strong>
                  </div>
                  <div>
                    <span>7-day average</span>
                    <strong>
                      {amountLabel(report.average_daily_ml_7d, display)}
                    </strong>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p>Loading water…</p>
          )}
        </section>
        <section className="water-panel water-log">
          <h2>Log water</h2>
          <p className="muted">Choose an amount or enter your own.</p>
          {report && (
            <div className="actions water-quick-add">
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
        </section>
      </div>
      <section className="water-panel water-history">
        <div className="water-history-header">
          <div>
            <h2>History</h2>
            <p className="muted">Daily totals and individual entries.</p>
          </div>
        </div>
        <div className="plan-week-bar" aria-label="Week navigation">
          <p className="plan-week-label">
            {new Date(from + "T12:00:00").toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
            {" – "}
            {new Date(to + "T12:00:00").toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
          <div className="plan-week-controls">
            <button
              aria-label="Previous week"
              title="Previous week"
              onClick={() => changeWeek(shift(from, -7))}
            >
              ←
            </button>
            <input
              type="date"
              aria-label="Week starting"
              title="Week starting Sunday; choose any date to view its week"
              required
              value={from}
              onChange={(e) => {
                if (e.target.value) changeWeek(e.target.value);
              }}
            />
            <button
              aria-label="Next week"
              title="Next week"
              onClick={() => changeWeek(shift(from, 7))}
            >
              →
            </button>
          </div>
        </div>
        {!history.data && <p className="muted">Loading history…</p>}
        <div className="water-days">
          {history.data?.days.map((d) => (
            <div className="water-day" key={d.date}>
              <span>
                {new Date(d.date + "T12:00:00").toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <p>{amountLabel(d.total_ml, display)}</p>
            </div>
          ))}
        </div>
        <ul className="shopping-list water-entries">
          {history.data?.entries
            .slice()
            .reverse()
            .map((entry) => (
              <li key={entry.id}>
                <div className="water-entry">
                  <strong>{amountLabel(entry.amount_ml, display)}</strong>
                  <span>
                    {new Date(entry.consumed_at).toLocaleString(undefined, {
                      timeZone: report?.settings.timezone,
                    })}
                  </span>
                </div>
                <button
                  className="water-delete"
                  title="Delete water entry"
                  aria-label="Delete water entry"
                  disabled={action.busy}
                  onClick={() => setRemoving(entry.id)}
                >
                  <ActionIcon action="delete" />
                </button>
              </li>
            ))}
        </ul>
        {history.data && !history.data.entries.length && (
          <p className="water-empty">No water entries in this date range.</p>
        )}
      </section>
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
