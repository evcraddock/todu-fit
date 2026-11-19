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

export function hasFinishedWeek(scope: Scope, week: string) {
  if (localStorage.getItem(finishedWeekKey(scope, week))) return true;
  // Older versions recorded a completed Saturday in its day note or session draft.
  const saturday = shift(week, 6);
  const key = (name: string, date: string) =>
    JSON.stringify([name, scope.root_id, scope.group_id, date]);
  if (localStorage.getItem(key("fit.guided-day-exception", saturday)))
    return true;
  const draft = JSON.parse(
    sessionStorage.getItem(key("fit.guided-day", week)) || "null",
  );
  return draft?.saved === true && draft.date === saturday;
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
