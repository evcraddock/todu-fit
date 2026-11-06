import React, { useEffect, useRef, useState } from "react";
import { call, type Config, type Identity } from "./api";
export type SetupState = {
  state: string;
  message: string;
  completed_documents: number;
};
export function Setup({
  state,
  identity,
  onChange,
}: {
  state: SetupState;
  identity: Identity;
  onChange: (state: SetupState) => void;
}) {
  const [mode, setMode] = useState<"new" | "join" | null>(
    identity.root_id ? "join" : null,
  );
  const [server, setServer] = useState("");
  const [root, setRoot] = useState(identity.root_id ?? "");
  const [group, setGroup] = useState("My household");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const retry = useRef<{ payload: string; id: string } | undefined>(undefined);
  useEffect(() => {
    let active = true;
    call<Config>({ type: "config_get" }, "configuration")
      .then((c) => {
        if (active) setServer(c.sync_server_url ?? "");
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    const operation = {
      type: "setup_start",
      root_id: mode === "join" ? root.trim() : null,
      server_url: server.trim() || null,
      group_name: mode === "new" ? group.trim() : null,
    };
    const payload = JSON.stringify(operation);
    if (retry.current?.payload !== payload)
      retry.current = { payload, id: crypto.randomUUID() };
    try {
      onChange(await call<SetupState>(operation, "setup", retry.current.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }
  const busy = sending || state.state === "running";
  if (!mode && !busy)
    return (
      <section className="setup setup-choice">
        <p className="eyebrow">LET’S GET YOU STARTED</p>
        <h1>Welcome to Fit</h1>
        <p className="setup-intro">
          A home for your dishes, meal plans, and daily nutrition.
        </p>
        <div className="setup-paths">
          <button className="setup-path" onClick={() => setMode("new")}>
            <span className="setup-symbol" aria-hidden="true">
              ＋
            </span>
            <strong>Start fresh</strong>
            <span>Create a new space for yourself or your household.</span>
            <span className="setup-path-action" aria-hidden="true">
              Get started →
            </span>
          </button>
          <button className="setup-path" onClick={() => setMode("join")}>
            <span className="setup-symbol" aria-hidden="true">
              ↗
            </span>
            <strong>Use existing data</strong>
            <span>Bring your Fit data over from another device.</span>
            <span className="setup-path-action" aria-hidden="true">
              Connect your data →
            </span>
          </button>
        </div>
        <p className="setup-footnote">
          Your data stays with you. Choose how you want to begin.
        </p>
      </section>
    );
  return (
    <section className="setup setup-form">
      {!busy && !identity.root_id && (
        <button
          className="setup-back"
          type="button"
          onClick={() => {
            setMode(null);
            setError("");
          }}
        >
          ← Back
        </button>
      )}
      <p className="eyebrow">
        {busy
          ? "SETTING UP FIT"
          : mode === "join"
            ? "YOUR EXISTING SPACE"
            : "A NEW SPACE"}
      </p>
      <h1>
        {busy
          ? "Getting your data ready"
          : mode === "join"
            ? "Use existing data"
            : "Start fresh"}
      </h1>
      <p className="setup-intro">
        {busy
          ? "You can leave Fit open while we prepare your data."
          : mode === "join"
            ? "Enter the root document ID and sync server from your existing Fit setup."
            : "Give your shared collection of dishes, meal plans, and shopping lists a name."}
      </p>
      {error && <p role="alert">{error}</p>}
      {state.state === "failed" && <p role="alert">{state.message}</p>}
      {busy ? (
        <div className="setup-progress" role="status" aria-live="polite">
          <progress aria-label="Setting up your data" />
          <p>{state.state === "running" ? state.message : "Starting setup…"}</p>
          {state.state === "running" && (
            <small>
              {state.completed_documents} documents downloaded. We’ll open Fit
              when everything is ready.
            </small>
          )}
        </div>
      ) : (
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <legend className="sr-only">
              {mode === "join" ? "Connect to existing data" : "Create new data"}
            </legend>
            {mode === "join" ? (
              <label className="field">
                Root document ID
                <input
                  required
                  value={root}
                  readOnly={!!identity.root_id}
                  onChange={(e) => setRoot(e.target.value)}
                  placeholder="Paste your root document ID"
                  autoCapitalize="none"
                  spellCheck={false}
                />
                <small>
                  This identifies your existing Fit data. It isn’t a group name.
                </small>
              </label>
            ) : (
              <label className="field">
                Group name
                <input
                  required
                  maxLength={512}
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                />
                <small>For example, “My household” or your own name.</small>
              </label>
            )}
            <label className="field">
              Sync server address{mode === "new" && " (optional)"}
              <input
                required={mode === "join"}
                placeholder="wss://your-sync-server"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
              />
              <small>
                {mode === "join"
                  ? "Use the server where your existing data is stored."
                  : "Leave blank to use Fit only on this computer."}
              </small>
            </label>
            <button className="primary setup-submit" type="submit">
              {state.state === "failed"
                ? "Retry setup"
                : mode === "join"
                  ? "Connect and download"
                  : "Create my space"}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
