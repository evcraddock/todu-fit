import { useState } from "react";
import { WeeklyNutrition } from "./WeeklyNutrition";
import { shift } from "./ui";

type Scope = { root_id: string; group_id: string };

export function finishedWeekKey(scope: Scope, week: string) {
  return JSON.stringify([
    "fit.guided-week-complete",
    scope.root_id,
    scope.group_id,
    week,
  ]);
}

export function markDayFinished(scope: Scope, date: string) {
  localStorage.setItem(
    JSON.stringify([
      "fit.guided-day-complete",
      scope.root_id,
      scope.group_id,
      date,
    ]),
    "true",
  );
}

export function hasFinishedWeek(scope: Scope, week: string) {
  if (localStorage.getItem(finishedWeekKey(scope, week))) return true;
  return Array.from({ length: 7 }, (_, i) => shift(week, i)).every((date) =>
    ["fit.guided-day-complete", "fit.guided-day-exception"].some(
      (name) =>
        localStorage.getItem(
          JSON.stringify([name, scope.root_id, scope.group_id, date]),
        ) !== null,
    ),
  );
}

export function FinishedWeek({
  scope,
  week,
  revision,
  onChooseDay,
  disabled,
}: {
  scope: Scope;
  week: string;
  revision: number;
  onChooseDay: (date: string) => void;
  disabled: boolean;
}) {
  const [day, setDay] = useState("");
  return (
    <>
      <h3>Weekly meal plan complete</h3>
      <p role="status">
        You’ve planned your meals for the week of{" "}
        {new Date(week + "T12:00:00").toLocaleDateString(undefined, {
          month: "long",
          day: "numeric",
        })}
        . Let me know if you’d like to make any changes.
      </p>
      <WeeklyNutrition scope={scope} week={week} revision={revision} />
      <form
        className="finished-week-picker"
        onSubmit={(e) => {
          e.preventDefault();
          if (day && !disabled) onChooseDay(day);
        }}
      >
        <label>
          Day to plan
          <input
            type="date"
            required
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </label>
        <button disabled={!day || disabled}>Open day</button>
      </form>
    </>
  );
}
