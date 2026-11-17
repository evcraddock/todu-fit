import { useState } from "react";
import { usePreferences } from "./preferences";
import { ActionIcon } from "./ActionIcon";
import {
  call,
  type Config,
  type Identity,
  type Status,
  type WaterSettings,
} from "./api";
import { Field, LoadError, useLoad, useAction, Confirm } from "./ui";
import type { Appearance } from "./theme";
export function Settings({
  appearance,
  onAppearanceChange,
  identity,
  status,
  revision,
  refresh,
}: {
  appearance: Appearance;
  onAppearanceChange: (value: Appearance) => void;
  identity: Identity;
  status?: Status;
  revision: number;
  refresh: () => void;
}) {
  const config = useLoad(
    () => call<Config>({ type: "config_get" }, "configuration"),
    revision,
  );
  const settings = usePreferences();
  const [group, setGroup] = useState(""),
    [joinId, setJoinId] = useState(""),
    [leaving, setLeaving] = useState<string>();
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupMode, setGroupMode] = useState<"create" | "join">("create");
  const [tab, setTab] = useState("General");
  const action = useAction(refresh);
  return (
    <section className="settings-screen">
      <h1>Settings</h1>
      <LoadError error={config.error || action.error} />
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Settings sections"
      >
        {["General", "Water", "Groups", "Sync"].map((name, index, tabs) => (
          <button
            key={name}
            id={`settings-tab-${name}`}
            role="tab"
            aria-selected={tab === name}
            aria-controls={`settings-panel-${name}`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => setTab(name)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft")
                next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              setTab(tabs[next]);
              document.getElementById(`settings-tab-${tabs[next]}`)?.focus();
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div
        className="settings-tab-panel"
        role="tabpanel"
        id="settings-panel-General"
        aria-labelledby="settings-tab-General"
        hidden={tab !== "General"}
      >
        <article className="settings-panel settings-appearance">
          <div>
            <h2>Appearance</h2>
            <p className="muted">
              Choose a theme, or follow your system appearance.
            </p>
          </div>
          <Field label="Theme">
            <select
              value={appearance}
              onChange={(e) => onAppearanceChange(e.target.value as Appearance)}
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </Field>
        </article>
        <TimezoneSettingsForm
          key={settings.timezone}
          timezone={settings.timezone}
          refresh={refresh}
        />
      </div>
      <div
        className="settings-tab-panel"
        role="tabpanel"
        id="settings-panel-Water"
        aria-labelledby="settings-tab-Water"
        hidden={tab !== "Water"}
      >
        <WaterSettingsForm
          key={JSON.stringify([
            settings.daily_goal_ml,
            settings.preferred_unit,
            settings.quick_add_presets_ml,
          ])}
          settings={settings}
          refresh={refresh}
        />
      </div>
      <div
        className="settings-tab-panel"
        role="tabpanel"
        id="settings-panel-Groups"
        aria-labelledby="settings-tab-Groups"
        hidden={tab !== "Groups"}
      >
        <article className="settings-panel">
          <h2>Groups</h2>
          <p className="muted">
            Choose the group you’re planning and sharing meals with.
          </p>
          {!identity.groups.length && (
            <p className="settings-note">
              No groups yet. Create one or join an existing group below.
            </p>
          )}
          <ul className="shopping-list settings-groups">
            {identity.groups.map((g) => (
              <li key={g.id}>
                <div>
                  <strong>{g.name}</strong>
                  {g.selected && (
                    <span className="settings-current">Current</span>
                  )}
                  <p>
                    <span className="muted">Group code</span>
                    <br />
                    <span className="group-code-value">
                      <code>{g.id}</code>
                      <CopyCode
                        value={g.id}
                        label={`group code for ${g.name}`}
                      />
                    </span>
                  </p>
                </div>
                <div className="actions">
                  <button
                    className="group-icon-button"
                    title={g.selected ? "Current group" : "Switch to group"}
                    aria-label={`Switch to ${g.name}`}
                    disabled={action.busy || g.selected}
                    onClick={() =>
                      action.run(() =>
                        action.mutate({ type: "group_select", name: g.name }),
                      )
                    }
                  >
                    <ActionIcon action="switch" />
                  </button>
                  <button
                    disabled={action.busy}
                    className="group-icon-button danger"
                    title="Leave group"
                    aria-label={`Leave ${g.name}`}
                    onClick={() => setLeaving(g.name)}
                  >
                    <ActionIcon action="leave" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {!addingGroup ? (
            <button onClick={() => setAddingGroup(true)}>
              {identity.groups.length ? "Add another group" : "Add a group"}
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                action.run(async () => {
                  await action.mutate(
                    groupMode === "join"
                      ? { type: "group_join", root_id: joinId, name: group }
                      : { type: "group_create", name: group },
                  );
                  setGroup("");
                  setJoinId("");
                  setAddingGroup(false);
                });
              }}
            >
              <fieldset disabled={action.busy} className="settings-group-form">
                <legend>Add a group</legend>
                <Field label="Create or join">
                  <select
                    value={groupMode}
                    onChange={(e) =>
                      setGroupMode(e.target.value as "create" | "join")
                    }
                  >
                    <option value="create">Create a new group</option>
                    <option value="join">Join an existing group</option>
                  </select>
                </Field>
                <Field label="Group name">
                  <input
                    value={group}
                    required
                    onChange={(e) => setGroup(e.target.value)}
                  />
                </Field>
                {groupMode === "join" && (
                  <Field label="Group code">
                    <input
                      aria-describedby="group-code-help"
                      value={joinId}
                      required
                      onChange={(e) => setJoinId(e.target.value)}
                    />
                    <small id="group-code-help" className="muted">
                      Ask someone in the group for their code.
                    </small>
                  </Field>
                )}
                <div className="actions">
                  <button className="primary" type="submit">
                    {groupMode === "join" ? "Join group" : "Create group"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingGroup(false);
                      setGroup("");
                      setJoinId("");
                      setGroupMode("create");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </fieldset>
            </form>
          )}
        </article>
      </div>
      <div
        className="settings-tab-panel"
        role="tabpanel"
        id="settings-panel-Sync"
        aria-labelledby="settings-tab-Sync"
        hidden={tab !== "Sync"}
      >
        <article className="settings-panel settings-identity">
          <h2>Sync</h2>
          <p className="muted">
            Keep your Fit data available across your devices.
          </p>
          <div className="settings-sync-layout">
            <div className="settings-personal-code">
              <h3>Personal sync code</h3>
              <p className="muted">
                Use this code to connect your personal Fit data on another
                device.
              </p>
              {identity.root_id && (
                <div className="group-code-value">
                  <code>{identity.root_id}</code>
                  <CopyCode
                    value={identity.root_id}
                    label="personal sync code"
                  />
                </div>
              )}
              <p className="settings-note">
                To share a group with someone else, use its code in the Groups
                tab.
              </p>
            </div>
            {config.data ? (
              <SyncSettingsForm
                key={JSON.stringify(config.data)}
                config={config.data}
                status={status}
                refresh={refresh}
              />
            ) : (
              <p className="muted">Loading sync settings…</p>
            )}
          </div>
        </article>
      </div>
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
function TimezoneSettingsForm({
  timezone,
  refresh,
}: {
  timezone: string;
  refresh: () => void;
}) {
  const [value, setValue] = useState(timezone);
  const action = useAction(refresh);
  return (
    <article className="settings-panel">
      <h2>Date and time</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          action.run(() =>
            action.mutate({
              type: "water_settings_update",
              fields: { timezone: value.trim() },
            }),
          );
        }}
      >
        <fieldset disabled={action.busy}>
          <Field label="Timezone">
            <input
              required
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
          <button
            className="primary"
            type="submit"
            disabled={value.trim() === timezone}
          >
            Save timezone
          </button>
        </fieldset>
        <LoadError error={action.error} />
      </form>
    </article>
  );
}

const waterAmountInUnit = (ml: number, unit: "ml" | "oz") =>
  String(unit === "oz" ? Math.round((ml / 29.5735) * 10) / 10 : Math.round(ml));

function WaterSettingsForm({
  settings,
  refresh,
}: {
  settings: WaterSettings;
  refresh: () => void;
}) {
  const [unit, setUnit] = useState(settings.preferred_unit),
    [goal, setGoal] = useState(
      waterAmountInUnit(settings.daily_goal_ml, settings.preferred_unit),
    ),
    [presets, setPresets] = useState(
      settings.quick_add_presets_ml
        .map((ml) => waterAmountInUnit(ml, settings.preferred_unit))
        .join(", "),
    );
  const [goalMl, setGoalMl] = useState(settings.daily_goal_ml);
  const [presetsMl, setPresetsMl] = useState(settings.quick_add_presets_ml);
  const changeUnit = (next: "ml" | "oz") => {
    setGoal(waterAmountInUnit(goalMl, next));
    setPresets(presetsMl.map((ml) => waterAmountInUnit(ml, next)).join(", "));
    setUnit(next);
  };
  const action = useAction(refresh);
  return (
    <article className="settings-panel settings-water">
      <h2>Water settings</h2>
      <p className="muted">
        Set your daily goal, display unit, and quick-add amounts.
      </p>
      <LoadError error={action.error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action.run(() =>
            action.mutate({
              type: "water_settings_update",
              fields: {
                goal: goalMl,
                unit: "ml",
                display_unit: unit,
                presets: presetsMl,
              },
            }),
          );
        }}
      >
        <fieldset disabled={action.busy}>
          <Field label="Display unit">
            <select
              value={unit}
              onChange={(e) => changeUnit(e.target.value as "ml" | "oz")}
            >
              <option value="ml">mL</option>
              <option value="oz">oz</option>
            </select>
          </Field>
          <Field label={`Daily goal (${unit === "ml" ? "mL" : "oz"})`}>
            <input
              type="number"
              min="0.01"
              step="any"
              required
              value={goal}
              onChange={(e) => {
                setGoal(e.target.value);
                setGoalMl(
                  Number(e.target.value) * (unit === "oz" ? 29.5735 : 1),
                );
              }}
            />
          </Field>
          <Field
            label={`Quick-add presets (${unit === "ml" ? "mL" : "oz"}, comma-separated)`}
          >
            <input
              required
              value={presets}
              onChange={(e) => {
                setPresets(e.target.value);
                setPresetsMl(
                  e.target.value
                    .split(",")
                    .map(
                      (x) => Number(x.trim()) * (unit === "oz" ? 29.5735 : 1),
                    ),
                );
              }}
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

function CopyCode({ value, label }: { value: string; label: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return (
    <span className="settings-copy">
      <button
        type="button"
        className="group-icon-button"
        title={`Copy ${label}`}
        aria-label={`Copy ${label}`}
        onClick={() => {
          setMessage("");
          setError("");
          const field = document.createElement("textarea");
          field.value = value;
          field.className = "sr-only";
          field.readOnly = true;
          const previousFocus = document.activeElement;
          document.body.appendChild(field);
          try {
            field.select();
            if (!document.execCommand("copy")) throw new Error("Copy failed");
            setMessage("Copied");
          } catch {
            setError("Could not copy. Select and copy the code manually.");
          } finally {
            field.remove();
            if (previousFocus instanceof HTMLElement) previousFocus.focus();
          }
        }}
      >
        <ActionIcon action="copy" />
      </button>
      <span role="status" className="settings-copy-feedback">
        {message}
      </span>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}

function SyncSettingsForm({
  config,
  status,
  refresh,
}: {
  config: Config;
  status?: Status;
  refresh: () => void;
}) {
  const [server, setServer] = useState(config.sync_server_url ?? "");
  const [automatic, setAutomatic] = useState(config.auto_sync);
  const [saved, setSaved] = useState(false);
  const action = useAction(refresh);
  const dirty =
    server.trim() !== (config.sync_server_url ?? "") ||
    automatic !== config.auto_sync;
  const syncing = status?.sync.state === "running";
  return (
    <form
      className="settings-sync-form"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        action.run(async () => {
          await action.call<Config>(
            {
              type: "config_update",
              server_url: server.trim() || null,
              auto_sync: automatic,
            },
            "configuration",
          );
          setSaved(true);
        });
      }}
    >
      <fieldset disabled={action.busy || syncing}>
        <Field label="Sync server address">
          <input
            type="url"
            placeholder="wss://your-sync-server"
            value={server}
            required={automatic}
            spellCheck={false}
            autoCapitalize="none"
            aria-describedby="sync-server-help"
            onChange={(e) => {
              setServer(e.target.value);
              setSaved(false);
            }}
          />
          <small id="sync-server-help" className="muted">
            Use the same server on each device. Leave blank to keep data only on
            this computer.
          </small>
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={automatic}
            onChange={(e) => {
              setAutomatic(e.target.checked);
              setSaved(false);
            }}
          />
          Automatic sync
        </label>
        <p className="settings-note">
          Sync changes automatically when a connection is available.
        </p>
        <div className="actions">
          <button type="submit" className="primary" disabled={!dirty}>
            Save sync settings
          </button>
          <button
            type="button"
            disabled={!config.sync_server_url || dirty}
            onClick={() =>
              action.run(() => action.mutate({ type: "sync_start" }))
            }
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </fieldset>
      <LoadError error={action.error} />
      <p role="status" className="settings-note">
        {saved
          ? "Sync settings saved."
          : syncing
            ? "Syncing…"
            : !status
              ? "Checking sync status…"
              : status.sync.state === "failed"
                ? `Sync failed: ${status.sync.message ?? "Unable to connect"}`
                : !config.sync_server_url
                  ? "Sync is not configured. Data stays on this computer."
                  : config.auto_sync
                    ? "Automatic sync is on. Changes are saved on this computer."
                    : "Automatic sync is off. Use Sync now to sync manually."}
      </p>
    </form>
  );
}
