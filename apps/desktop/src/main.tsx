import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { call, type Identity, type Status } from "./api";
import { Dishes } from "./Dishes";
import { Meals } from "./Meals";
import { Shopping } from "./Shopping";
import { Water } from "./Water";
import { PreferencesProvider } from "./preferences";
import { NavigationIcon } from "./NavigationIcon";
import { Settings } from "./Settings";
import "./style.css";
import { BrandIcon } from "./BrandIcon";
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
          <BrandIcon />
          <span className="brand-name">todufit</span>
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
      <aside
        className={`sidebar${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
      >
        <div className="sidebar-header">
          <div className="brand">
            <BrandIcon />
            <span className="brand-name">todufit</span>
          </div>
          <button
            className="sidebar-toggle"
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!sidebarCollapsed}
            aria-controls="main-navigation"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={sidebarCollapsed ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} />
            </svg>
          </button>
        </div>
        <nav id="main-navigation" aria-label="Main navigation">
          {(
            ["Dishes", "Meal plans", "Food log", "Shopping", "Water"] as Page[]
          ).map((p) => (
            <button
              key={p}
              aria-label={p}
              title={sidebarCollapsed ? p : undefined}
              aria-current={page === p ? "page" : undefined}
              onClick={() => setPage(p)}
            >
              <NavigationIcon page={p} />
              <span>{p}</span>
            </button>
          ))}
          <button
            className="settings-navigation"
            aria-label="Settings"
            title="Settings"
            aria-current={page === "Settings" ? "page" : undefined}
            onClick={() => setPage("Settings")}
          >
            <NavigationIcon page="Settings" />
            <span>Settings</span>
          </button>
        </nav>
      </aside>
      <main>
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
      <footer className="status-bar" aria-label="App status">
        <div
          className="status-group"
          role="status"
          title={group ? `Current group: ${group.name}` : "No group selected"}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="9" cy="8" r="3" />
            <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2" />
          </svg>
          <span>{group ? `Group: ${group.name}` : "No group selected"}</span>
        </div>
      </footer>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
