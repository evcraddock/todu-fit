import { call } from "./api";
import { metrics, range } from "./NutritionTargets";
import { comparison, type Context } from "./planning";
import { LoadError, shift, useLoad } from "./ui";

type Metric = keyof typeof metrics;
const primary: Metric[] = [
  "calories_kcal",
  "protein_g",
  "carbohydrates_g",
  "fat_g",
];

export function WeeklyNutrition({
  scope,
  week,
  revision,
}: {
  scope: { root_id: string; group_id: string };
  week: string;
  revision: number;
}) {
  const key = JSON.stringify([scope.root_id, scope.group_id, week]);
  const { data, error } = useLoad(
    () =>
      call<Context>(
        { type: "planning_context", ...scope, week },
        "planning_context",
      ),
    key + revision,
    key,
  );
  if (error) return <LoadError error={error} />;
  if (!data) return <p role="status">Loading weekly nutrition…</p>;
  return (
    <section className="weekly-nutrition" aria-label="Weekly nutrition">
      <h3>Weekly nutrition</h3>
      {Object.entries(data.people).map(([id, person]) => {
        const keys = [
          ...new Set([
            ...primary,
            ...(Object.keys(person.targets) as Metric[]),
          ]),
        ].filter((k) => k !== "water_fl_oz");
        return (
          <section key={id}>
            <h4>{person.name}</h4>
            {Array.from({ length: 7 }, (_, i) => {
              const date = shift(week, i);
              const meals = data.existing.filter((m) => m.date === date);
              const assigned = meals.some((m) =>
                Object.values(m.portions?.[id]?.servings ?? {}).some(
                  (n) => n > 0,
                ),
              );
              const rows = keys.map((k) => {
                const bounds = person.targets[k];
                const { total, partial } = comparison(data, [], date, id, k);
                const status =
                  bounds?.max != null && total > bounds.max
                    ? "Above target"
                    : partial
                      ? "Incomplete"
                      : bounds?.min != null && total < bounds.min
                        ? "Below target"
                        : bounds?.min != null || bounds?.max != null
                          ? "Within target"
                          : "No target";
                return { k, bounds, total, partial, status };
              });
              const missed = rows.filter(
                (r) =>
                  r.status === "Above target" || r.status === "Below target",
              ).length;
              const incomplete = rows.some((r) => r.partial);
              const planned = assigned || incomplete;
              const label = !meals.length
                ? "No meals planned"
                : !planned
                  ? "No portions planned"
                  : [
                      missed
                        ? `${missed} ${missed === 1 ? "target" : "targets"} missed`
                        : "",
                      incomplete ? "Incomplete data" : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") ||
                    (rows.some((r) => r.status === "Within target")
                      ? "Within targets"
                      : "No targets set");
              const day = new Date(date + "T12:00:00").toLocaleDateString(
                undefined,
                { weekday: "short", month: "short", day: "numeric" },
              );
              return (
                <details key={date}>
                  <summary>
                    <span className="nutrition-day">{day}</span>
                    <span
                      className={planned && missed ? "target-missed" : "muted"}
                    >
                      {label}
                    </span>
                  </summary>
                  {planned && (
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Nutrient</th>
                          <th scope="col">Planned</th>
                          <th scope="col">Daily target</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(({ k, bounds, total, partial, status }) => (
                          <tr key={k}>
                            <th scope="row">
                              {metrics[k][0]} <small>({metrics[k][1]})</small>
                            </th>
                            <td>
                              {+total.toFixed(1)}
                              {partial && (
                                <small className="nutrition-detail">
                                  Partial total
                                </small>
                              )}
                            </td>
                            <td>
                              {(bounds && range(bounds.min, bounds.max)) || "—"}
                              <small
                                className={
                                  status === "Above target" ||
                                  status === "Below target"
                                    ? "nutrition-detail target-missed"
                                    : "nutrition-detail"
                                }
                              >
                                {status}
                              </small>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </details>
              );
            })}
          </section>
        );
      })}
    </section>
  );
}
