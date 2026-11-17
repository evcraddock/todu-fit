import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { call, type Identity, type Status } from "./api";
import { Dishes } from "./Dishes";
import { Meals } from "./Meals";
import { Shopping } from "./Shopping";
import { Water } from "./Water";
import { PreferencesProvider } from "./preferences";
import { Settings } from "./Settings";
import "./style.css";
import { Setup, type SetupState } from "./Setup";
import { trackPointerHover } from "./pointerHover";
import {
  applyAppearance,
  readAppearance,
  saveAppearance,
  type Appearance,
} from "./theme";

// Apply the saved theme before the first React render.
const initialAppearance = readAppearance();
document.documentElement.dataset.theme =
  initialAppearance === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : initialAppearance;

type Page =
  | "Dishes"
  | "Meal plans"
  | "Food log"
  | "Shopping"
  | "Water"
  | "Settings";
function App() {
  const [appearance, setAppearance] = useState<Appearance>(initialAppearance);
  useEffect(() => applyAppearance(appearance), [appearance]);
  const changeAppearance = (value: Appearance) => {
    saveAppearance(value);
    setAppearance(value);
  };
  useEffect(() => trackPointerHover(document), []);
  const [page, setPage] = useState<Page>("Dishes");
  const [revision, setRevision] = useState(0);
  const [identity, setIdentity] = useState<Identity>();
  const [setup, setSetup] = useState<SetupState>();
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = () => setRevision((r) => r + 1);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [id, state, setupState] = await Promise.all([
          call<Identity>({ type: "identity_get" }, "identity"),
          call<Status>({ type: "status" }, "status"),
          call<SetupState>({ type: "setup_status" }, "setup"),
        ]);
        if (active) {
          setSetup(setupState);
          setIdentity(id);
          setStatus(state);
        }
        if (active) {
          setIdentity(id);
          setStatus(state);
          setError("");
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let previous = -1;
    const poll = async () => {
      try {
        const [s, setupState] = await Promise.all([
          call<Status>({ type: "status" }, "status"),
          call<SetupState>({ type: "setup_status" }, "setup"),
        ]);
        if (active) {
          setSetup(setupState);
          setStatus(s);
          if (previous !== s.revision) refresh();
          previous = s.revision;
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
      if (active) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  const group = identity?.groups.find((g) => g.selected);
  const available = identity?.state === "initialized";
  if (loading || !identity || setup?.state !== "ready" || !available) {
    return (
      <div className="onboarding">
        <div className="onboarding-brand brand">
          todu<span>fit</span>
        </div>
        <main className="onboarding-main">
          {error && (
            <p role="alert">
              {error} <button onClick={refresh}>Retry connection</button>
            </p>
          )}
          {loading ? (
            <section className="setup">
              <h1>Opening Fit…</h1>
              <p>Connecting to your data.</p>
            </section>
          ) : !identity ? (
            <section className="setup">
              <h1>Unable to connect</h1>
              <p>Check the connection and try again.</p>
              <button onClick={refresh}>Retry connection</button>
            </section>
          ) : (
            <Setup
              identity={identity}
              state={
                setup ?? {
                  state: "required",
                  message: "",
                  completed_documents: 0,
                }
              }
              onChange={setSetup}
            />
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <aside>
        <div className="brand">
          todu<span>fit</span>
        </div>
        <p className="muted">Plan well. Feel good.</p>
        <nav aria-label="Main navigation">
          {(
            ["Dishes", "Meal plans", "Food log", "Shopping", "Water"] as Page[]
          ).map((p) => (
            <button
              key={p}
              aria-current={page === p ? "page" : undefined}
              onClick={() => setPage(p)}
            >
              {p}
            </button>
          ))}
          <div className="connection">
            <strong>{group?.name ?? "No group selected"}</strong>
          </div>
          <button
            className="settings-navigation"
            aria-label="Settings"
            title="Settings"
            aria-current={page === "Settings" ? "page" : undefined}
            onClick={() => setPage("Settings")}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="m9.5 3-.5 2a7.5 7.5 0 0 0-1.8 1L5.2 5.4 2.7 9.6l1.5 1.4a7.5 7.5 0 0 0 0 2l-1.5 1.4 2.5 4.2 2-.6a7.5 7.5 0 0 0 1.8 1l.5 2h5l.5-2a7.5 7.5 0 0 0 1.8-1l2 .6 2.5-4.2-1.5-1.4a7.5 7.5 0 0 0 0-2l1.5-1.4-2.5-4.2-2 .6A7.5 7.5 0 0 0 15 5l-.5-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>Settings</span>
          </button>
        </nav>
      </aside>
      <main>
        <div className="topbar">
          Your personal nutrition workspace <span>Desktop</span>
        </div>
        {error && (
          <p role="alert">
            {error} <button onClick={refresh}>Retry connection</button>
          </p>
        )}
        {loading ? (
          <p>Connecting to your data…</p>
        ) : !identity ? (
          <p>Unable to load your data. Retry when the daemon is available.</p>
        ) : setup?.state !== "ready" || !available ? (
          <Setup
            identity={identity}
            state={
              setup ?? {
                state: "required",
                message: "",
                completed_documents: 0,
              }
            }
            onChange={setSetup}
          />
        ) : (
          <PreferencesProvider
            key={`${identity.root_id}:${group?.id ?? ""}`}
            revision={revision}
          >
            {page === "Settings" ? (
              <Settings
                status={status}
                appearance={appearance}
                onAppearanceChange={changeAppearance}
                identity={identity}
                revision={revision}
                refresh={refresh}
              />
            ) : page === "Water" ? (
              <Water revision={revision} refresh={refresh} />
            ) : page === "Food log" ? (
              <Meals
                key="logs"
                logs
                hasGroup={Boolean(group)}
                revision={revision}
                refresh={refresh}
              />
            ) : !group ? (
              <section>
                <h1>Choose a group</h1>
                <p>
                  Create or join a group in Settings to work with shared dishes
                  and plans.
                </p>
                <button onClick={() => setPage("Settings")}>
                  Open settings
                </button>
              </section>
            ) : page === "Dishes" ? (
              <Dishes revision={revision} refresh={refresh} />
            ) : page === "Meal plans" ? (
              <Meals key="plans" revision={revision} refresh={refresh} />
            ) : (
              <Shopping revision={revision} refresh={refresh} />
            )}
          </PreferencesProvider>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
