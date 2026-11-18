import { useEffect, useRef, useState } from "react";
import { MODEL_CHANGED_EVENT } from "./ModelStatus";
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
  method: string;
  flow?: string;
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
  const [authMethod, setAuthMethod] = useState("");
  const [systemProviders, setSystemProviders] = useState<string[]>([]);
  const [addingProvider, setAddingProvider] = useState(false);
  const [changingConnection, setChangingConnection] = useState(false);
  const [models, setModels] = useState<(Model & { provider: string })[]>([]);
  const [login, setLogin] = useState<Login | null>(null);
  const [auth, setAuth] = useState<string>("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const provider = settings?.providers.find((p) => p.id === providerId);
  const pending = login?.status === "pending";
  const restoringLogin = useRef(false);
  const openedLogin = useRef<string | null>(null);
  const browserEvent =
    pending &&
    login.events.find((event) => event.type === "auth_url" && event.url);
  const browserUrl = browserEvent ? browserEvent.url : undefined;
  const deviceEvent =
    pending && login.events.find((event) => event.type === "device_code");
  const browserFallback = Boolean(
    browserUrl &&
      login?.provider === "openai-codex" &&
      login.prompt?.placeholder?.includes("/auth/callback"),
  );
  useEffect(() => {
    if (!pending || !browserUrl || !login || openedLogin.current === login.id)
      return;
    openedLogin.current = login.id;
    void request({ type: "login_open_link", url: browserUrl }).catch(() => {
      setError("Could not open your browser. Use Reopen browser to try again.");
    });
  }, [pending, browserUrl, login?.id]);
  const method = provider?.methods.find((m) => m.id === authMethod);
  const connected = auth.startsWith("Connected");
  const connectedProviders =
    settings?.providers.filter(
      (p) => p.stored || systemProviders.includes(p.id),
    ) ?? [];
  const connectedIds = connectedProviders
    .map((p) => p.id)
    .sort()
    .join(",");
  async function loadModels(refresh = false) {
    const groups = await Promise.allSettled(
      connectedProviders.map(async (p) =>
        (
          await request<Model[]>({
            type: refresh ? "models_refresh" : "models",
            provider: p.id,
          })
        ).map((m) => ({ ...m, provider: p.id })),
      ),
    );
    return {
      models: groups.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      ),
      failed: groups.flatMap((result, index) =>
        result.status === "rejected" ? [connectedProviders[index].name] : [],
      ),
    };
  }
  useEffect(() => {
    let active = true;
    void loadModels()
      .then((value) => {
        if (active) {
          setModels(value.models);
          if (value.failed.length)
            setError(
              `Could not load models from ${value.failed.join(", ")}. Try Refresh models.`,
            );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [connectedIds, settings]);
  useEffect(() => {
    let active = true;
    const candidates = settings?.providers.filter((p) => !p.stored) ?? [];
    void Promise.allSettled(
      candidates.map((p) =>
        request<{ type: string } | null>({
          type: "auth_status",
          provider: p.id,
        }),
      ),
    ).then((results) => {
      if (!active) return;
      setSystemProviders(
        results.flatMap((result, index) =>
          result.status === "fulfilled" && result.value
            ? [candidates[index].id]
            : [],
        ),
      );
      const failed = results.flatMap((result, index) =>
        result.status === "rejected" ? [candidates[index].name] : [],
      );
      if (failed.length)
        setError(`Could not check connections for ${failed.join(", ")}.`);
    });
    return () => {
      active = false;
    };
  }, [settings]);
  function selectProvider(p: Provider) {
    const nextMethod =
      p.stored ??
      (p.methods.some((m) => m.id === "api_key") ? "api_key" : "oauth");
    if (p.id !== providerId || nextMethod !== authMethod) setAuth("");
    setProvider(p.id);
    setAuthMethod(nextMethod);
    setMessage("");
    setError("");
  }
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
        if (restoringLogin.current) return;
        const selected = value.providers.find(
          (p) => p.id === value.model?.provider,
        );
        setAuthMethod(
          selected
            ? (selected.stored ??
                (selected.methods.some((m) => m.id === "api_key")
                  ? "api_key"
                  : "oauth"))
            : "",
        );
        setProvider(value.model?.provider ?? "");
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

    setAuth("");
    if (providerId) {
      request<{ source?: string; type: string } | null>({
        type: "auth_status",
        provider: providerId,
      })
        .then((value) => {
          if (active)
            setAuth(
              value && value.type === authMethod
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
  }, [providerId, settings, authMethod]);
  // Poll the small login state only; no tokens are returned by the host.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await request<Login | null>({ type: "login_status" });
        if (!active) return;
        restoringLogin.current = value?.status === "pending";
        setLogin(value);
        if (value?.status === "pending") {
          setAddingProvider(true);
          setProvider(value.provider);
          setAuthMethod(value.method);
          timer = setTimeout(poll, 300);
        } else if (value?.status === "done") {
          setChangingConnection(false);
          setAddingProvider(false);
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
  const startApiKeyLogin = (id: string) =>
    run(async () => {
      setLogin(
        await request<Login>({
          type: "login_start",
          provider: id,
          method: "api_key",
        }),
      );
    });
  const openLink = (url: string) =>
    run(() => request({ type: "login_open_link", url }));
  return (
    <article className="settings-panel ai-settings">
      <LoadError error={error} />
      {!settings ? (
        <p role="status">Loading providers…</p>
      ) : (
        <>
          <section className="ai-section" aria-labelledby="ai-providers-title">
            <div className="ai-section-heading">
              <h2 id="ai-providers-title">Connected providers</h2>
              <button
                disabled={busy || pending || addingProvider}
                onClick={() => {
                  setAddingProvider(true);
                  setChangingConnection(false);
                  setProvider("");
                  setAuthMethod("");
                  setAuth("");
                  setMessage("");
                  setError("");
                }}
              >
                Add provider
              </button>
            </div>
            {connectedProviders.length === 0 ? (
              <p className="muted">No providers connected yet.</p>
            ) : (
              <ul className="ai-provider-list">
                {connectedProviders.map((p) => (
                  <li key={p.id}>
                    <div>
                      <strong>{p.name}</strong>
                      <span className="muted">
                        {p.stored === "oauth"
                          ? "Account"
                          : p.stored === "api_key"
                            ? "API key"
                            : "System credentials"}
                      </span>
                    </div>
                    <button
                      disabled={busy || pending}
                      aria-label={`Manage ${p.name}`}
                      onClick={() => {
                        selectProvider(p);
                        setAddingProvider(true);
                        setChangingConnection(true);
                        if (
                          p.stored === "api_key" ||
                          (!p.stored &&
                            p.methods.some((m) => m.id === "api_key"))
                        )
                          void startApiKeyLogin(p.id);
                      }}
                    >
                      Manage
                    </button>
                    {p.stored && (
                      <button
                        disabled={busy || pending}
                        aria-label={`Sign out of ${p.name}`}
                        onClick={() =>
                          run(async () => {
                            await request({ type: "logout", provider: p.id });
                            if (providerId === p.id) {
                              setAuth("");
                              setProvider("");
                            }
                            await loadSettings();
                            setMessage("Signed out.");
                          })
                        }
                      >
                        Sign out
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {addingProvider && (
            <section
              className="ai-section"
              aria-labelledby="ai-connection-title"
            >
              <div className="ai-section-heading">
                <h2 id="ai-connection-title">
                  {changingConnection ? "Manage provider" : "Add provider"}
                </h2>
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
              {!pending && (
                <button
                  className="ai-close-provider"
                  onClick={() => {
                    setAddingProvider(false);
                    setChangingConnection(false);
                    const saved =
                      settings.providers.find(
                        (p) => p.id === settings.model?.provider,
                      ) ?? connectedProviders[0];
                    if (saved) selectProvider(saved);
                  }}
                >
                  Cancel
                </button>
              )}
              <fieldset className="ai-auth-options" disabled={busy || pending}>
                <legend>Connect using</legend>
                {[
                  { id: "oauth", label: "Account" },
                  { id: "api_key", label: "API key" },
                ].map((option) => (
                  <label
                    key={option.id}
                    className={authMethod === option.id ? "selected" : ""}
                  >
                    <input
                      type="radio"
                      name="ai-auth-method"
                      value={option.id}
                      checked={authMethod === option.id}
                      onChange={() => {
                        setAuthMethod(option.id);
                        setProvider("");

                        setAuth("");

                        setChangingConnection(false);
                        setMessage("");
                        setError("");
                      }}
                    />
                    {option.label}
                  </label>
                ))}
              </fieldset>
              <Field label="Provider">
                <select
                  aria-label="Provider"
                  value={providerId}
                  disabled={busy || pending || !authMethod}
                  onChange={(e) => {
                    const next = e.target.value;
                    setAuth("");
                    setProvider(next);
                    setChangingConnection(false);
                    setMessage("");
                    setError("");
                    if (
                      next &&
                      authMethod === "api_key" &&
                      settings.secureStorage
                    )
                      void startApiKeyLogin(next);
                  }}
                >
                  <option value="">
                    {authMethod
                      ? "Select a provider"
                      : "Choose account or API key first"}
                  </option>
                  {settings.providers
                    .filter((p) => p.methods.some((m) => m.id === authMethod))
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
                  {pending && login.method === "api_key" && (
                    <div className="ai-api-key-form">
                      {login.prompt ? (
                        <LoginPrompt
                          key={login.prompt.id}
                          prompt={login.prompt}
                          busy={busy}
                          submitLabel="Save API key"
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
                      ) : (
                        <p role="status">Preparing connection…</p>
                      )}
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await request({ type: "login_cancel" });
                            setAddingProvider(false);
                            setChangingConnection(false);
                            const saved =
                              settings.providers.find(
                                (p) => p.id === settings.model?.provider,
                              ) ?? connectedProviders[0];
                            if (saved) selectProvider(saved);
                          })
                        }
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {(!connected || changingConnection) &&
                    method?.id === "oauth" && (
                      <>
                        <p className="muted ai-auth-description">
                          {method.label}
                        </p>
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
                          await request({
                            type: "logout",
                            provider: providerId,
                          });
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
          )}
          {pending && login.method !== "api_key" && (
            <section className="ai-login" aria-label="Provider sign-in">
              <h3>
                {deviceEvent
                  ? "Sign in with a device code"
                  : browserUrl
                    ? "Waiting for sign-in…"
                    : "Connect your account"}
              </h3>
              {browserUrl && (
                <p className="muted" role="status">
                  Finish in your browser. We’ll update this page when you’re
                  connected.
                </p>
              )}
              {deviceEvent && (
                <div className="ai-device-code">
                  <p className="muted">
                    Open this address in any browser and enter the code.
                  </p>
                  <p className="ai-verification-url">
                    {deviceEvent.verificationUri}
                  </p>
                  <strong>{deviceEvent.userCode}</strong>
                </div>
              )}
              {login.events
                .filter(
                  (event) => !["auth_url", "device_code"].includes(event.type),
                )
                .map((event, index) => (
                  <div key={index}>
                    {event.message && <p>{event.message}</p>}
                    {event.instructions && <p>{event.instructions}</p>}
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
              {login.prompt && !browserFallback && (
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
              <div className="ai-login-actions">
                {browserUrl && (
                  <button disabled={busy} onClick={() => openLink(browserUrl)}>
                    Reopen browser
                  </button>
                )}
                {deviceEvent && deviceEvent.verificationUri && (
                  <button
                    disabled={busy}
                    onClick={() => openLink(deviceEvent.verificationUri!)}
                  >
                    Open sign-in page
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() => run(() => request({ type: "login_cancel" }))}
                >
                  Cancel
                </button>
              </div>
              {(browserFallback ||
                (login.provider === "openai-codex" &&
                  login.method === "oauth")) && (
                <details className="ai-login-options" key={login.id}>
                  <summary>Other sign-in options</summary>
                  {login.provider === "openai-codex" &&
                    login.method === "oauth" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await request({ type: "login_cancel" });
                            setLogin(
                              await request<Login>({
                                type: "login_start",
                                provider: login.provider,
                                method: "oauth",
                                flow:
                                  login.flow === "device_code"
                                    ? "browser"
                                    : "device_code",
                              }),
                            );
                          })
                        }
                      >
                        {login.flow === "device_code"
                          ? "Use browser instead"
                          : "Use device code instead"}
                      </button>
                    )}
                  {browserFallback && login.prompt && (
                    <details className="ai-login-manual">
                      <summary>Enter a redirect URL manually</summary>
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
                    </details>
                  )}
                </details>
              )}
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
                value={
                  settings.model &&
                  models.some(
                    (m) =>
                      m.provider === settings.model!.provider &&
                      m.id === settings.model!.modelId,
                  )
                    ? JSON.stringify([
                        settings.model.provider,
                        settings.model.modelId,
                      ])
                    : ""
                }
                disabled={busy || pending || models.length === 0}
                onChange={(e) => {
                  const next = e.target.value;
                  if (!next) return;
                  void run(async () => {
                    await request({
                      type: "settings_save",
                      model: {
                        provider: JSON.parse(next)[0],
                        modelId: JSON.parse(next)[1],
                      },
                    });
                    await loadSettings();
                    window.dispatchEvent(new Event(MODEL_CHANGED_EVENT));
                    setMessage("Model saved.");
                  });
                }}
              >
                <option value="">
                  {models.length
                    ? "Select a model"
                    : "Connect a provider to choose a model"}
                </option>
                {connectedProviders
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((p) => (
                    <optgroup key={p.id} label={p.name}>
                      {models
                        .filter((m) => m.provider === p.id)
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((m) => (
                          <option
                            key={m.id}
                            value={JSON.stringify([p.id, m.id])}
                          >
                            {m.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
              </select>
              <button
                className="ai-refresh"
                aria-label="Refresh models"
                title="Refresh models"
                disabled={busy || pending || connectedProviders.length === 0}
                onClick={() =>
                  run(async () => {
                    const result = await loadModels(true);
                    setModels(result.models);
                    if (result.failed.length)
                      setError(
                        `Could not refresh models from ${result.failed.join(", ")}.`,
                      );
                    else setMessage("Models refreshed.");
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
  submitLabel = "Continue",
}: {
  prompt: Prompt;
  busy: boolean;
  submit: (answer: string) => Promise<void>;
  submitLabel?: string;
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
      <button type="submit" disabled={busy || !answer.trim()}>
        {submitLabel}
      </button>
    </form>
  );
}
