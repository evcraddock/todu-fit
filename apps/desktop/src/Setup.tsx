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
  const [mode, setMode] = useState(identity.root_id ? "join" : "new");
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
  return (
    <section className="setup">
      <h1>Welcome to Fit</h1>
      <p>Start fresh or connect to the data you already use.</p>
      {error && <p role="alert">{error}</p>}
      {state.state === "failed" && <p role="alert">{state.message}</p>}
      {state.state === "running" && (
        <div role="status" aria-live="polite">
          <progress aria-label="Setting up your data" />
          <p>{state.message}</p>
          <p>
            {state.completed_documents} documents downloaded. Discovering
            related data as we go.
          </p>
        </div>
      )}
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <legend>Set up your data</legend>
          <label>
            <input
              type="radio"
              name="setup-mode"
              checked={mode === "new"}
              disabled={!!identity.root_id}
              onChange={() => setMode("new")}
            />{" "}
            Start fresh
          </label>
          <label>
            <input
              type="radio"
              name="setup-mode"
              checked={mode === "join"}
              onChange={() => setMode("join")}
            />{" "}
            Connect to existing data
          </label>
          {mode === "join" ? (
            <label>
              Root document ID
              <input
                required
                value={root}
                readOnly={!!identity.root_id}
                onChange={(e) => setRoot(e.target.value)}
              />
            </label>
          ) : (
            <label>
              Group name
              <input
                required
                maxLength={512}
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              />
              <small>
                A shared collection of dishes, meal plans, and shopping lists.
              </small>
            </label>
          )}
          <label>
            Sync server address{mode === "new" && " (optional)"}
            <input
              required={mode === "join"}
              placeholder="wss://your-sync-server"
              value={server}
              onChange={(e) => setServer(e.target.value)}
            />
          </label>
          {mode === "new" && <p>Leave the server blank to use Fit locally.</p>}
          <button type="submit">
            {busy
              ? "Setting up…"
              : state.state === "failed"
                ? "Retry setup"
                : mode === "join"
                  ? "Connect and download"
                  : "Create my data"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
