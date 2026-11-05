import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { call, type Dish, type Identity, type Status } from "./api";
import { Dishes } from "./Dishes";
import { Meals } from "./Meals";
import { Shopping } from "./Shopping";
import { Water } from "./Water";
import { Settings } from "./Settings";
import "./style.css";
import { Setup, type SetupState } from "./Setup";
type Page =
  "Dishes" | "Meal plans" | "Food log" | "Shopping" | "Water" | "Settings";
function App() {
  const [page, setPage] = useState<Page>("Dishes");
  const [revision, setRevision] = useState(0);
  const [identity, setIdentity] = useState<Identity>();
  const scopeOf = (id?: Identity) =>
    `${id?.root_id ?? ""}:${id?.groups.find((g) => g.selected)?.id ?? ""}`;
  const [dishResult, setDishes] = useState<{ scope: string; data: Dish[] }>({
    scope: "",
    data: [],
  });
  const dishes = dishResult.scope === scopeOf(identity) ? dishResult.data : [];
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
        const ds =
          setupState.state === "ready" &&
          id.state === "initialized" &&
          id.groups.length
            ? await call<Dish[]>({ type: "dishes_list" }, "dishes")
            : [];
        if (active) {
          setIdentity(id);
          setDishes({ scope: scopeOf(id), data: ds });
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
  return (
    <div className="app">
      <aside>
        <div className="brand">
          todu<span>fit</span>
        </div>
        <p className="muted">Plan well. Feel good.</p>
        <nav aria-label="Main navigation">
          {(
            [
              "Dishes",
              "Meal plans",
              "Food log",
              "Shopping",
              "Water",
              "Settings",
            ] as Page[]
          ).map((p) => (
            <button
              key={p}
              aria-current={page === p ? "page" : undefined}
              onClick={() => setPage(p)}
            >
              {p}
            </button>
          ))}
        </nav>
        <div className="connection">
          <strong>{group?.name ?? "No group selected"}</strong>
          <p role="status">
            {status?.sync.state === "failed"
              ? `Sync failed: ${status.sync.message}`
              : status?.sync.state === "running"
                ? "Syncing…"
                : "Saved on this computer"}
          </p>
          <button onClick={refresh}>Refresh</button>
        </div>
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
          <div key={`${identity.root_id}:${group?.id ?? ""}`}>
            {page === "Settings" ? (
              <Settings
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
                dishes={dishes}
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
              <Dishes dishes={dishes} refresh={refresh} />
            ) : page === "Meal plans" ? (
              <Meals
                key="plans"
                dishes={dishes}
                revision={revision}
                refresh={refresh}
              />
            ) : (
              <Shopping revision={revision} refresh={refresh} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
