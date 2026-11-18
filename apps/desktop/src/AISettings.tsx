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
  const [models, setModels] = useState<Model[]>([]);
  const [login, setLogin] = useState<Login | null>(null);
  const [auth, setAuth] = useState<string>("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const provider = settings?.providers.find((p) => p.id === providerId);
  const pending = login?.status === "pending";
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
      <h2>AI assistant</h2>
      <p className="muted">
        Choose a provider and default model for assistant conversations.
      </p>
      <LoadError error={error} />
      {!settings ? (
        <p role="status">Loading providers…</p>
      ) : (
        <>
          <Field label="Provider">
            <select
              aria-label="Provider"
              value={providerId}
              disabled={busy || pending}
              onChange={(e) => {
                setProvider(e.target.value);
                setModel("");
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
            <>
              <p role="status" className="settings-note">
                {auth || "Checking connection…"}
              </p>
              {!settings.secureStorage && (
                <p role="alert">
                  Secure credential storage is unavailable. Unlock your system
                  keychain to sign in. Providers configured through the
                  environment remain available.
                </p>
              )}
              <div className="actions">
                {provider.methods.map((method) => (
                  <button
                    key={method.id}
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
                    {method.label}
                  </button>
                ))}
                {provider.stored && (
                  <button
                    disabled={busy || pending}
                    onClick={() =>
                      run(async () => {
                        await request({ type: "logout", provider: providerId });
                        await loadSettings();
                        setMessage("Saved credentials removed.");
                      })
                    }
                  >
                    Sign out
                  </button>
                )}
              </div>
              {!provider.methods.length && (
                <p className="muted">
                  This provider uses credentials from its environment or system
                  configuration.
                </p>
              )}
            </>
          )}
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
          {provider && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await request({
                    type: "settings_save",
                    model: { provider: providerId, modelId },
                  });
                  await loadSettings();
                  setMessage("Default model saved.");
                });
              }}
            >
              <Field label="Default model">
                <select
                  aria-label="Default model"
                  value={modelId}
                  required
                  disabled={busy || pending}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="">Select a model</option>
                  {[...models]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </Field>
              <button
                type="button"
                disabled={busy || pending}
                onClick={() =>
                  run(async () => {
                    setModels(
                      await request<Model[]>({
                        type: "models_refresh",
                        provider: providerId,
                      }),
                    );
                    setMessage("Model list refreshed.");
                  })
                }
              >
                Refresh models
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  pending ||
                  !modelId ||
                  (settings.model?.provider === providerId &&
                    settings.model?.modelId === modelId)
                }
              >
                Save model
              </button>
            </form>
          )}
          <p role="status" className="settings-note">
            {message}
          </p>
          <p className="muted">
            Settings and saved conversations are stored on this computer.
            Conversations resume when you reopen todufit.
          </p>
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
