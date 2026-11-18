import fs from "node:fs/promises";
import { modelCatalog, writeJson } from "./catalog.mjs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteDatabase } from "@earendil-works/chord/sqlite/node";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";

function text(value, label, maximum = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw Error(`Invalid ${label}`);
  return value;
}
export function credentialStore(vault) {
  let line = Promise.resolve();
  const locked = (fn, options) => {
    const next = line.then(() => {
      options?.signal?.throwIfAborted();
      return fn();
    });
    line = next.catch(() => {});
    return next;
  };
  return {
    read: (id, options) =>
      locked(async () => (await vault({ type: "read" }))[id], options),
    list: (options) =>
      locked(
        async () =>
          Object.entries(await vault({ type: "read" })).map(
            ([providerId, value]) => ({ providerId, type: value.type }),
          ),
        options,
      ),
    modify: (id, fn, options) =>
      locked(async () => {
        const values = await vault({ type: "read" });
        const updated = await fn(values[id]);
        options?.signal?.throwIfAborted();
        if (updated !== undefined) {
          values[id] = updated;
          await vault({ type: "write", value: values });
        }
        return values[id];
      }, options),
    delete: (id, options) =>
      locked(async () => {
        const values = await vault({ type: "read" });
        delete values[id];
        await vault({ type: "write", value: values });
      }, options),
  };
}

export async function openAssistant({
  directory,
  vault,
  models: suppliedModels,
  registry = createRegistry(),
}) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const installationFile = path.join(directory, "installation.json");
  let installation;
  try {
    installation = JSON.parse(await fs.readFile(installationFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    installation = { id: randomUUID() };
    await writeJson(installationFile, installation);
  }
  if (
    typeof installation.id !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(installation.id)
  )
    throw Error("Invalid assistant installation identity");
  const credentials = credentialStore(vault);
  const models =
    suppliedModels ??
    builtinModels({ credentials, modelsStore: await modelCatalog(directory) });
  const restored = await models.refresh({
    allowNetwork: false,
    signal: AbortSignal.timeout(10_000),
  });
  if (restored.aborted || restored.errors.size)
    throw Error("Unable to restore provider catalogs");
  const database = await openNodeSqliteDatabase(
    path.join(directory, "conversations.sqlite"),
  );
  await database.exec("PRAGMA synchronous = FULL; PRAGMA fullfsync = ON;");
  const harness = await Harness.open(
    await SqliteStorage.open(database),
    { models, registry },
    context,
  );
  const settingsFile = path.join(directory, "settings.json");
  let settings = {};
  try {
    settings = JSON.parse(await fs.readFile(settingsFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      await harness.close(context);
      throw error;
    }
  }
  let login;
  let closed = false;
  function provider(id) {
    const result = models.getProvider(text(id, "provider"));
    if (!result) throw Error("Unknown provider");
    return result;
  }
  function model(value) {
    provider(value.provider);
    if (!models.getModel(value.provider, text(value.modelId, "model")))
      throw Error("Unknown model");
    return { provider: value.provider, modelId: value.modelId };
  }
  async function availableModels(id) {
    provider(id);
    return models.getAvailable(id, { signal: AbortSignal.timeout(10_000) });
  }
  async function requireAvailableModel(selected) {
    const available = await availableModels(selected.provider);
    if (!available.some((item) => item.id === selected.modelId))
      throw Error("This model is not available for the connected provider.");
    return selected;
  }
  async function conversation(id) {
    if (!Number.isSafeInteger(id) || id < 0)
      throw Error("Invalid conversation");
    const result = await harness.conversation(id, context);
    if (!result) throw Error("Conversation not found");
    return result;
  }
  function loginState() {
    if (!login) return null;
    return {
      id: login.id,
      provider: login.provider,
      method: login.method,
      flow: login.flow,
      status: login.status,
      events: login.events,
      prompt: login.prompt,
      error: login.error,
    };
  }
  function beginLogin(op) {
    const p = provider(op.provider);
    if (
      !["api_key", "oauth"].includes(op.method) ||
      !(op.method === "oauth" ? p.auth.oauth : p.auth.apiKey?.login)
    )
      throw Error("Unsupported sign-in method");
    if (login?.status === "pending")
      throw Error("Finish or cancel the current sign-in first");
    if (
      op.flow !== undefined &&
      (p.id !== "openai-codex" ||
        op.method !== "oauth" ||
        !["browser", "device_code"].includes(op.flow))
    )
      throw Error("Unsupported sign-in flow");
    const controller = new AbortController();
    const state = {
      id: randomUUID(),
      provider: p.id,
      method: op.method,
      flow: op.flow ?? "browser",
      status: "pending",
      events: [],
      controller,
    };
    login = state;
    state.finished = models
      .login(
        p.id,
        op.method,
        {
          signal: controller.signal,
          notify(event) {
            state.events = [...state.events.slice(-19), structuredClone(event)];
          },
          prompt(prompt) {
            // Pi owns OAuth; a desktop uses its browser flow by default.
            if (
              p.id === "openai-codex" &&
              op.method === "oauth" &&
              prompt.type === "select" &&
              prompt.options?.some((option) => option.id === "browser") &&
              prompt.options?.some((option) => option.id === "device_code")
            )
              return Promise.resolve(state.flow);
            const id = randomUUID();
            const { signal, ...fields } = prompt;
            state.prompt = { ...fields, id };
            return new Promise((resolve, reject) => {
              const cleanup = () => {
                signal?.removeEventListener("abort", abort);
                controller.signal.removeEventListener("abort", abort);
                if (state.prompt?.id === id) state.prompt = undefined;
                state.answer = undefined;
              };
              const abort = () => {
                cleanup();
                reject(Error("Sign-in cancelled"));
              };
              state.answer = (answer) => {
                cleanup();
                resolve(answer);
              };
              signal?.addEventListener("abort", abort, { once: true });
              controller.signal.addEventListener("abort", abort, {
                once: true,
              });
              if (signal?.aborted || controller.signal.aborted) abort();
            });
          },
        },
        { agentName: "todufit", getDeviceId: () => installation.id },
      )
      .then(
        async () => {
          try {
            const refreshed = await models.refresh({
              providers: [p.id],
              signal: AbortSignal.timeout(15_000),
            });
            if (refreshed.aborted || refreshed.errors.size)
              state.error =
                "Connected, but the model list could not be refreshed. Try Refresh models.";
          } catch {
            state.error =
              "Connected, but the model list could not be refreshed. Try Refresh models.";
          }
          state.status = "done";
        },
        () => {
          state.status = controller.signal.aborted ? "cancelled" : "failed";
          state.error = controller.signal.aborted
            ? undefined
            : "Sign-in failed. Check your credentials and try again.";
        },
      )
      .finally(() => {
        state.prompt = undefined;
        state.answer = undefined;
      });
    return loginState();
  }
  // No extra coordinator: Pi owns task recovery, retry receipts and conversation state.
  harness.resume();
  return {
    harness,
    async request(op) {
      if (closed || !op || typeof op !== "object")
        throw Error("Assistant unavailable");
      switch (op.type) {
        case "settings": {
          const stored = await credentials.list();
          return {
            model: settings.model ?? null,
            providers: models.getProviders().map((p) => ({
              id: p.id,
              name: p.name,
              methods: [
                ...(p.auth.apiKey?.login
                  ? [{ id: "api_key", label: p.auth.apiKey.name }]
                  : []),
                ...(p.auth.oauth
                  ? [
                      {
                        id: "oauth",
                        label: p.auth.oauth.loginLabel ?? p.auth.oauth.name,
                      },
                    ]
                  : []),
              ],
              stored: stored.find((c) => c.providerId === p.id)?.type ?? null,
            })),
          };
        }
        case "models":
          provider(op.provider);
          return (await availableModels(op.provider)).map((m) => ({
            id: m.id,
            name: m.name,
          }));
        case "models_refresh": {
          provider(op.provider);
          const result = await models.refresh({
            providers: [op.provider],
            signal: AbortSignal.timeout(15_000),
          });
          if (result.aborted || result.errors.size)
            throw Error(
              "Unable to refresh models. Check the provider connection.",
            );
          return (await availableModels(op.provider)).map((m) => ({
            id: m.id,
            name: m.name,
          }));
        }
        case "auth_status": {
          provider(op.provider);
          try {
            return (
              (await models.checkAuth(op.provider, {
                signal: AbortSignal.timeout(10_000),
              })) ?? null
            );
          } catch {
            throw Error(
              "Unable to check authentication. Try signing in again.",
            );
          }
        }
        case "settings_save": {
          const next = { model: model(op.model) };
          const authentication = await models.checkAuth(next.model.provider, {
            signal: AbortSignal.timeout(10_000),
          });
          if (!authentication)
            throw Error(
              "Connect this provider before selecting a default model.",
            );
          await requireAvailableModel(next.model);
          await writeJson(settingsFile, next);
          settings = next;
          return settings;
        }
        case "login_start":
          return beginLogin(op);
        case "login_status":
          return loginState();
        case "login_answer": {
          if (
            !login ||
            login.id !== op.id ||
            login.prompt?.id !== op.promptId ||
            !login.answer
          )
            throw Error("Sign-in prompt expired");
          if (typeof op.answer !== "string" || op.answer.length > 16_384)
            throw Error("Invalid sign-in response");
          if (
            login.prompt.type === "select" &&
            !login.prompt.options.some((o) => o.id === op.answer)
          )
            throw Error("Invalid selection");
          login.answer(op.answer);
          return null;
        }
        case "login_cancel":
          login?.controller.abort();
          await login?.finished;
          return null;
        case "logout":
          provider(op.provider);
          if (login?.status === "pending")
            throw Error("Finish or cancel sign-in first");
          await models.logout(op.provider);
          return null;
        case "conversation_create": {
          const selected = await requireAvailableModel(
            model(op.model ?? settings.model ?? {}),
          );
          const result = await harness.createConversation(
            { ownership: { kind: "ownerless" }, agent: { model: selected } },
            context,
          );
          return { id: result.id };
        }
        case "conversation_list":
          return harness.commit(
            (tx) =>
              tx.scanConversations({ order: "descending" }, 50, op.cursor),
            context,
          );
        case "conversation_get": {
          await conversation(op.id);
          const observation = await harness.observeConversation(
            op.id,
            { advance() {}, end() {} },
            context,
            { min: 100, max: 100 },
          );
          const view = observation.value;
          observation.detach();
          return view;
        }
        case "conversation_entries":
          return (await conversation(op.id)).entries(
            { order: "descending" },
            100,
            op.cursor,
            context,
          );
        case "conversation_send": {
          const requestId = text(op.requestId, "request ID");
          const submission = await (
            await conversation(op.id)
          ).submit(
            {
              type: "input",
              content: text(op.content, "message", 100_000),
              requestId,
            },
            context,
          );
          return { id: submission.id };
        }
        case "conversation_cancel":
          await (await conversation(op.id)).abort(context);
          return null;
        default:
          throw Error("Unknown assistant operation");
      }
    },
    async close() {
      closed = true;
      login?.controller.abort();
      if (login) await login.finished;
      await harness.close(context);
    },
  };
}
