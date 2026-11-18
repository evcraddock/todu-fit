import { useState } from "react";
import { call, type Group } from "./api";
import { Field, LoadError, useAction, useLoad } from "./ui";

export const metrics = {
  calories_kcal: ["Calories", "kcal"],
  protein_g: ["Protein", "g"],
  carbohydrates_g: ["Carbohydrates", "g"],
  fat_g: ["Fat", "g"],
  saturated_fat_g: ["Saturated fat", "g"],
  fiber_g: ["Fiber", "g"],
  added_sugar_g: ["Added sugar", "g"],
  sodium_mg: ["Sodium", "mg"],
  water_fl_oz: ["Water", "fl oz"],
} as const;
type Metric = keyof typeof metrics;
const keys = Object.keys(metrics) as Metric[];
type Bounds = {
  min: number | null;
  max: number | null;
  reference_min: number | null;
  reference_max: number | null;
};
export type Profile = {
  name: string;
  targets: Partial<Record<Metric, Bounds>>;
};
type Personal = { profile: Profile | null; shared_groups: string[] };
const empty = (): Bounds => ({
  min: null,
  max: null,
  reference_min: null,
  reference_max: null,
});
export function range(lo: number | null, hi: number | null) {
  if (lo != null && hi != null) return lo === hi ? String(lo) : `${lo}–${hi}`;
  if (lo != null) return `At least ${lo}`;
  if (hi != null) return `At most ${hi}`;
  return "";
}

export function NutritionTargets({
  groups,
  waterGoal,
  onEditWater,
  revision,
  refresh,
}: {
  groups: Group[];
  waterGoal: string;
  onEditWater: () => void;
  revision: number;
  refresh: () => void;
}) {
  const current = groups.find((g) => g.selected);
  const personal = useLoad(
    () =>
      call<Personal>({ type: "nutrition_targets_get" }, "nutrition_targets"),
    revision,
  );
  const shared = useLoad(
    () =>
      call<Profile[]>(
        { type: "group_nutrition_targets", group_id: current!.id },
        "group_nutrition_targets",
      ),
    revision,
    current?.id,
    !!current,
  );
  return (
    <div
      role="tabpanel"
      id="settings-panel-Nutrition"
      aria-labelledby="settings-tab-Nutrition"
      className="settings-tab-panel"
    >
      <LoadError error={personal.error} />
      {personal.data && (
        <TargetsEditor
          waterGoal={waterGoal}
          onEditWater={onEditWater}
          personal={personal.data}
          groups={groups}
          refresh={refresh}
        />
      )}
      {current && (
        <article className="settings-panel">
          <h2>Shared with {current.name}</h2>
          <LoadError error={shared.error} />
          {shared.data?.length === 0 && (
            <p>No one has shared targets with this group yet.</p>
          )}
          {shared.data?.map((p, i) => (
            <details key={i}>
              <summary>{p.name}</summary>
              <dl className="shared-targets">
                {keys.map((k) => {
                  const b = p.targets[k];
                  if (!b) return null;
                  return (
                    <div key={k}>
                      <dt>{metrics[k][0]}</dt>
                      <dd>
                        {range(b.min, b.max)} {metrics[k][1]}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </details>
          ))}
        </article>
      )}
    </div>
  );
}

function TargetsEditor({
  personal,
  waterGoal,
  onEditWater,
  groups,
  refresh,
}: {
  personal: Personal;
  groups: Group[];
  waterGoal: string;
  onEditWater: () => void;
  refresh: () => void;
}) {
  const [edit, setEdit] = useState<{
    profile: Profile;
    expected: Profile | null;
  }>();
  const action = useAction(refresh);
  const profile = edit?.profile ??
    personal.profile ?? { name: "", targets: {} };
  const update = (p: Profile) =>
    setEdit({ profile: p, expected: edit ? edit.expected : personal.profile });
  function change(k: Metric, bound: "min" | "max", raw: string) {
    const targets = { ...profile.targets };
    const value = {
      ...empty(),
      ...targets[k],
      [bound]: raw === "" ? null : Number(raw),
    };
    if (value.min === null && value.max === null) delete targets[k];
    else targets[k] = value;
    update({ ...profile, targets });
  }
  function input(k: Metric, bound: "min" | "max", label: string) {
    return (
      <input
        type="number"
        step="any"
        min="0"
        aria-label={metrics[k][0] + " " + label}
        value={profile.targets[k]?.[bound] ?? ""}
        onChange={(e) => change(k, bound, e.target.value)}
      />
    );
  }
  return (
    <>
      <article className="settings-panel">
        <h2>My daily nutrition targets</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await action.call(
                {
                  type: "nutrition_targets_save",
                  profile,
                  expected: edit?.expected ?? null,
                },
                "nutrition_targets",
              );
              setEdit(undefined);
            });
          }}
        >
          <fieldset disabled={action.busy} className="nutrition-editor">
            <Field label="Display name">
              <input
                required
                maxLength={100}
                value={profile.name}
                onChange={(e) => update({ ...profile, name: e.target.value })}
              />
            </Field>
            <table>
              <thead>
                <tr>
                  <th scope="col">Daily target</th>
                  <th scope="col">Minimum</th>
                  <th scope="col">Maximum</th>
                </tr>
              </thead>
              <tbody>
                {keys
                  .filter((k) => k !== "water_fl_oz")
                  .map((k) => (
                    <tr key={k}>
                      <th scope="row">
                        {metrics[k][0]} <small>({metrics[k][1]})</small>
                      </th>
                      <td>{input(k, "min", "minimum")}</td>
                      <td>{input(k, "max", "maximum")}</td>
                    </tr>
                  ))}
                <tr>
                  <th scope="row">Water</th>
                  <td>{waterGoal}</td>
                  <td>
                    <a
                      href="#settings-panel-Water"
                      onClick={(e) => {
                        e.preventDefault();
                        onEditWater();
                      }}
                    >
                      Edit in Water
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="actions">
              <button className="primary" disabled={!edit}>
                Save targets
              </button>
              {edit && (
                <button type="button" onClick={() => setEdit(undefined)}>
                  Discard changes
                </button>
              )}
            </div>
          </fieldset>
        </form>
        <LoadError error={action.error} />
      </article>
      <article className="settings-panel">
        <h2>Share my targets</h2>
        <p>
          Everyone in a group you choose can see your name and daily targets,
          including future updates.
        </p>
        {!groups.length && (
          <p>Join or create a group in Groups to share your targets.</p>
        )}
        {groups.map((g) => {
          const enabled = personal.shared_groups.includes(g.id);
          return (
            <div className="target-share" key={g.id}>
              <strong>{g.name}</strong>
              <button
                disabled={action.busy || !!edit || !personal.profile}
                onClick={() =>
                  void action.run(async () => {
                    await action.call(
                      {
                        type: "nutrition_targets_share",
                        group_id: g.id,
                        share: !enabled,
                        expected: personal.profile,
                      },
                      "nutrition_targets",
                    );
                  })
                }
              >
                {enabled ? "Stop sharing" : "Share targets"}
              </button>
            </div>
          );
        })}
      </article>
    </>
  );
}
