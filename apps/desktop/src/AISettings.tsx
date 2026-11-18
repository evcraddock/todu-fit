import { useEffect, useState } from "react";
import { Field, LoadError } from "./ui";
import type { Operation } from "./api";

type Provider = {
  id: string;
  name: string;
  methods: { id: string; label: string }[];
  stored: string | null;
};
type Model = { id: string; name: string };
type Selection = { provider: string; modelId: string };
type Settings = {
  model: Selection | null;
  providers: Provider[];
  secureStorage: boolean;
};
type Prompt = {
  id: string;
  type: string;
  message: string;
  placeholder?: string;
  options?: { id: string; label: string; description?: string }[];
};
type Login = {
  id: string;
  provider: string;
  status: string;
  prompt?: Prompt;
  error?: string;
  events: {
    type: string;
    message?: string;
    url?: string;
    instructions?: string;
    userCode?: string;
    verificationUri?: string;
    links?: { label?: string; url: string }[];
  }[];
};
async function request<T>(operation: Operation): Promise<T> {
  const result = await window.fit.assistant(operation);
  if (!result.ok) throw Error(result.error);
  return result.value as T;
}
export function AISettings() {
  const [settings, setSettings] = useState<Settings>();
  const [providerId, setProvider] = useState("");
  const [modelId, setModel] = useState("");
  const [authMethod, setAuthMethod] = useState("");
  const [changingConnection, setChangingConnection] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [login, setLogin] = useState<Login | null>(null);
  const [auth, setAuth] = useState<string>("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const provider = settings?.providers.find((p) => p.id === providerId);
  const pending = login?.status === "pending";
  const method =
    provider?.methods.find((m) => m.id === authMethod) ??
    provider?.methods.find((m) => m.id === "oauth") ??
    provider?.methods[0];
  const connected = auth.startsWith("Connected");
  const loadSettings = async () => {
    const value = await request<Settings>({ type: "settings" });
    setSettings(value);
    return value;
  };
  useEffect(() => {
    let active = true;
    request<Settings>({ type: "settings" })
      .then((value) => {
        if (!active) return;
        setSettings(value);
        setProvider(value.model?.provider ?? "");
        setModel(value.model?.modelId ?? "");
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setModels([]);
    setAuth("");
    if (providerId) {
      request<Model[]>({ type: "models", provider: providerId })
        .then((value) => {
          if (active) setModels(value);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
      request<{ source?: string } | null>({
        type: "auth_status",
        provider: providerId,
      })
        .then((value) => {
          if (active)
            setAuth(
              value
                ? `Connected${value.source ? ` · ${value.source}` : ""}`
                : "Not connected",
            );
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [providerId, settings]);
  // Poll the small login state only; no tokens are returned by the host.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await request<Login | null>({ type: "login_status" });
        if (!active) return;
        setLogin(value);
        if (value?.status === "pending") timer = setTimeout(poll, 300);
        else if (value?.status === "done") {
          setChangingConnection(false);
          setMessage("Connected.");
          await loadSettings();
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [login?.id]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const openLink = (url: string) =>
    run(() => request({ type: "login_open_link", url }));
  return (
    <article className="settings-panel ai-settings">
      <LoadError error={error} />
      {!settings ? (
        <p role="status">Loading providers…</p>
      ) : (
        <>
          <section className="ai-section" aria-labelledby="ai-connection-title">
            <div className="ai-section-heading">
              <h2 id="ai-connection-title">Connection</h2>
              {provider && (
                <span
                  role="status"
                  className={`ai-connection-status${connected ? " connected" : ""}`}
                >
                  <span aria-hidden="true" />
                  {connected
                    ? "Connected"
                    : auth
                      ? "Not connected"
                      : "Checking…"}
                </span>
              )}
            </div>
            <Field label="Provider">
              <select
                aria-label="Provider"
                value={providerId}
                disabled={busy || pending}
                onChange={(e) => {
                  const next = e.target.value;
                  setAuth("");
                  setProvider(next);
                  setModel(
                    settings.model?.provider === next
                      ? settings.model.modelId
                      : "",
                  );
                  setAuthMethod("");
                  setChangingConnection(false);
                  setMessage("");
                  setError("");
                }}
              >
                <option value="">Select a provider</option>
                {[...settings.providers]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
            {provider && (
              <div className="ai-account">
                {(!connected || changingConnection) && method && (
                  <>
                    {provider.methods.length > 1 ? (
                      <Field label="Sign-in method">
                        <select
                          aria-label="Sign-in method"
                          value={method.id}
                          disabled={busy || pending}
                          onChange={(e) => setAuthMethod(e.target.value)}
                        >
                          {provider.methods.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ) : (
                      <p className="muted ai-auth-description">
                        {method.label}
                      </p>
                    )}
                    <button
                      className="primary"
                      disabled={busy || pending || !settings.secureStorage}
                      onClick={() =>
                        run(async () => {
                          setLogin(
                            await request<Login>({
                              type: "login_start",
                              provider: providerId,
                              method: method.id,
                            }),
                          );
                        })
                      }
                    >
                      {pending
                        ? "Signing in…"
                        : method.id === "oauth"
                          ? "Sign in"
                          : "Connect"}
                    </button>
                  </>
                )}
                {connected && (
                  <p className="muted ai-auth-description">
                    {auth.replace(/^Connected[ ·]*/, "") || provider.name}
                  </p>
                )}
                {connected &&
                  !changingConnection &&
                  provider.methods.length > 0 && (
                    <button
                      disabled={busy || pending}
                      onClick={() => setChangingConnection(true)}
                    >
                      Change connection
                    </button>
                  )}
                {changingConnection && !pending && (
                  <button
                    disabled={busy}
                    onClick={() => setChangingConnection(false)}
                  >
                    Cancel
                  </button>
                )}
                {provider.stored && (
                  <button
                    disabled={busy || pending}
                    onClick={() =>
                      run(async () => {
                        await request({ type: "logout", provider: providerId });
                        await loadSettings();
                        setMessage("Signed out.");
                      })
                    }
                  >
                    Sign out
                  </button>
                )}
                {!provider.methods.length && !connected && (
                  <p className="muted">
                    Uses this provider’s environment or system credentials.
                  </p>
                )}
                {!settings.secureStorage && !connected && (
                  <p role="alert">
                    Unlock your system keychain to save a connection.
                  </p>
                )}
              </div>
            )}
          </section>
          {pending && (
            <section className="ai-login" aria-label="Provider sign-in">
              <h3>
                Connect{" "}
                {settings.providers.find((p) => p.id === login.provider)
                  ?.name ?? login.provider}
              </h3>
              {login.events.map((event, index) => (
                <div key={index}>
                  {event.message && <p>{event.message}</p>}
                  {event.instructions && <p>{event.instructions}</p>}
                  {event.userCode && (
                    <p>
                      Code: <strong>{event.userCode}</strong>
                    </p>
                  )}
                  {(event.url || event.verificationUri) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        openLink((event.url ?? event.verificationUri)!)
                      }
                    >
                      Open sign-in page
                    </button>
                  )}
                  {event.links?.map((link) => (
                    <button
                      key={link.url}
                      disabled={busy}
                      onClick={() => openLink(link.url)}
                    >
                      {link.label ?? "Open provider instructions"}
                    </button>
                  ))}
                </div>
              ))}
              {login.prompt && (
                <LoginPrompt
                  key={login.prompt.id}
                  prompt={login.prompt}
                  busy={busy}
                  submit={(answer) =>
                    run(() =>
                      request({
                        type: "login_answer",
                        id: login.id,
                        promptId: login.prompt!.id,
                        answer,
                      }),
                    )
                  }
                />
              )}
              <button
                disabled={busy}
                onClick={() => run(() => request({ type: "login_cancel" }))}
              >
                Cancel sign-in
              </button>
            </section>
          )}
          {login?.error && <LoadError error={login.error} />}
          <section
            className="ai-section ai-model-section"
            aria-labelledby="ai-model-title"
          >
            <div className="ai-section-heading">
              <div>
                <h2 id="ai-model-title">Default model</h2>
                <p className="muted">Used for new conversations.</p>
              </div>
            </div>
            <div className="ai-model-control">
              <select
                aria-label="Default model"
                value={connected ? modelId : ""}
                disabled={busy || pending || !connected}
                onChange={(e) => {
                  const next = e.target.value;
                  if (!next) return;
                  void run(async () => {
                    await request({
                      type: "settings_save",
                      model: { provider: providerId, modelId: next },
                    });
                    setModel(next);
                    await loadSettings();
                    setMessage("Model saved.");
                  });
                }}
              >
                <option value="">
                  {!provider
                    ? "Choose a provider first"
                    : !connected
                      ? "Connect this provider first"
                      : "Select a model"}
                </option>
                {[...models]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
              <button
                className="ai-refresh"
                aria-label="Refresh models"
                title="Refresh models"
                disabled={busy || pending || !connected}
                onClick={() =>
                  run(async () => {
                    setModels(
                      await request<Model[]>({
                        type: "models_refresh",
                        provider: providerId,
                      }),
                    );
                    setMessage("Models refreshed.");
                  })
                }
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 7v5h-5M4 17v-5h5" />
                  <path d="M6.1 6.1A8 8 0 0 1 19.8 10M4.2 14a8 8 0 0 0 13.7 3.9" />
                </svg>
              </button>
            </div>
            <p role="status" className="ai-save-status">
              {busy ? "Working…" : message}
            </p>
          </section>
        </>
      )}
    </article>
  );
}
function LoginPrompt({
  prompt,
  busy,
  submit,
}: {
  prompt: Prompt;
  busy: boolean;
  submit: (answer: string) => Promise<void>;
}) {
  const [answer, setAnswer] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(answer).then(() => setAnswer(""));
      }}
    >
      <Field label={prompt.message}>
        {prompt.type === "select" ? (
          <select
            required
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          >
            <option value="">Select an option</option>
            {prompt.options?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={prompt.type === "secret" ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
            value={answer}
            placeholder={prompt.placeholder}
            onChange={(e) => setAnswer(e.target.value)}
          />
        )}
      </Field>
      <button type="submit" disabled={busy}>
        Continue
      </button>
    </form>
  );
}
