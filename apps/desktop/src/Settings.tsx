import { useState } from "react";
import { call, type Config, type Identity, type WaterSettings } from "./api";
import { Field, LoadError, useLoad, useAction, Confirm } from "./ui";
export function Settings({
  identity,
  revision,
  refresh,
}: {
  identity: Identity;
  revision: number;
  refresh: () => void;
}) {
  const config = useLoad(
    () => call<Config>({ type: "config_get" }, "configuration"),
    revision,
  );
  const settings = useLoad(
    () => call<WaterSettings>({ type: "water_settings_get" }, "water_settings"),
    revision,
  );
  const [group, setGroup] = useState(""),
    [joinId, setJoinId] = useState(""),
    [leaving, setLeaving] = useState<string>();
  const action = useAction(refresh);
  return (
    <section>
      <h1>Settings</h1>
      <LoadError error={config.error || settings.error || action.error} />
      <article>
        <h2>Identity and sync</h2>
        <p>
          Root document: <code>{identity.root_id ?? "Not initialized"}</code>
        </p>
        <p>State: {identity.state}</p>
        <p>Sync server: {config.data?.sync_server_url ?? "Not configured"}</p>
        <p>Automatic sync: {config.data?.auto_sync ? "On" : "Off"}</p>
        <p className="muted">
          Connection settings come from the daemon configuration. Existing
          identity and storage are managed separately.
        </p>
        <button
          disabled={action.busy}
          onClick={() =>
            action.run(() => action.mutate({ type: "sync_start" }))
          }
        >
          Sync now
        </button>
      </article>
      <article>
        <h2>Groups</h2>
        <ul className="shopping-list">
          {identity.groups.map((g) => (
            <li key={g.id}>
              <div>
                <strong>{g.name}</strong>
                {g.selected && " · Current"}
                <p>
                  <code>{g.id}</code>
                </p>
              </div>
              <div className="actions">
                <button
                  disabled={action.busy || g.selected}
                  onClick={() =>
                    action.run(() =>
                      action.mutate({ type: "group_select", name: g.name }),
                    )
                  }
                >
                  Select group
                </button>
                <button
                  disabled={action.busy}
                  onClick={() => setLeaving(g.name)}
                >
                  Leave group
                </button>
              </div>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action.run(async () => {
              await action.mutate(
                joinId
                  ? { type: "group_join", root_id: joinId, name: group }
                  : { type: "group_create", name: group },
              );
              setGroup("");
              setJoinId("");
            });
          }}
        >
          <fieldset disabled={action.busy}>
            <Field label="Group name">
              <input
                value={group}
                required
                onChange={(e) => setGroup(e.target.value)}
              />
            </Field>
            <Field label="Group document ID (only to join an existing group)">
              <input
                value={joinId}
                onChange={(e) => setJoinId(e.target.value)}
              />
            </Field>
            <button type="submit">
              {joinId ? "Join group" : "Create group"}
            </button>
          </fieldset>
        </form>
      </article>
      {settings.data && (
        <WaterSettingsForm
          key={JSON.stringify(settings.data)}
          settings={settings.data}
          refresh={refresh}
        />
      )}
      {leaving && (
        <Confirm
          title={`Leave ${leaving}?`}
          busy={action.busy}
          onCancel={() => setLeaving(undefined)}
          onConfirm={() =>
            action.run(async () => {
              await action.mutate({ type: "group_leave", name: leaving });
              setLeaving(undefined);
            })
          }
        />
      )}
    </section>
  );
}
function WaterSettingsForm({
  settings,
  refresh,
}: {
  settings: WaterSettings;
  refresh: () => void;
}) {
  const [unit, setUnit] = useState(settings.preferred_unit),
    [timezone, setTimezone] = useState(settings.timezone),
    [goal, setGoal] = useState(String(settings.daily_goal_ml)),
    [presets, setPresets] = useState(settings.quick_add_presets_ml.join(", "));
  const action = useAction(refresh);
  return (
    <article>
      <h2>Water settings</h2>
      <LoadError error={action.error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action.run(() =>
            action.mutate({
              type: "water_settings_update",
              fields: {
                goal: Number(goal),
                unit: "ml",
                display_unit: unit,
                timezone,
                presets: presets.split(",").map((x) => Number(x.trim())),
              },
            }),
          );
        }}
      >
        <fieldset disabled={action.busy}>
          <Field label="Display unit">
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as "ml" | "oz")}
            >
              <option value="ml">mL</option>
              <option value="oz">oz</option>
            </select>
          </Field>
          <Field label="Timezone">
            <input
              required
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
          </Field>
          <Field label="Daily goal (mL)">
            <input
              type="number"
              min="1"
              required
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </Field>
          <Field label="Quick-add presets (mL, comma-separated)">
            <input
              required
              value={presets}
              onChange={(e) => setPresets(e.target.value)}
            />
          </Field>
          <button className="primary" type="submit">
            Save water settings
          </button>
        </fieldset>
      </form>
    </article>
  );
}
