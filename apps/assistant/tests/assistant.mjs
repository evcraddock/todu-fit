import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxProvider,
  fauxAssistantMessage,
} from "@earendil-works/pi-ai/providers/faux";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { openAssistant, credentialStore } from "../src/runtime.mjs";
import { credentialVault } from "../../desktop/electron/assistant/credentials.cjs";
import { withRemoteCatalog } from "../src/remote-catalog.mjs";
import { modelCatalog } from "../src/catalog.mjs";

test("remote models reach the picker, persist offline, and force refresh revalidates", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  let fail = false;
  const fetchCatalog = async (url, options) => {
    calls++;
    assert.equal(url.origin, "https://pi.dev");
    assert.equal(url.pathname, "/api/models/providers/test");
    assert.equal(url.searchParams.get("types"), "chat,image,classifier");
    assert.equal(options.headers.authorization, undefined);
    if (fail) throw Error("offline");
    if (calls > 1) {
      assert.equal(options.headers["if-none-match"], '"catalog-v1"');
      return new Response(null, { status: 304 });
    }
    return Response.json(
      [
        {
          ...f.faux.provider.getModels()[0],
          id: "gpt-6.2-sol",
          name: "GPT-6.2 Sol",
        },
      ],
      {
        headers: {
          "last-modified": "Thu, 19 Nov 2026 12:00:00 GMT",
          etag: '"catalog-v1"',
        },
      },
    );
  };
  const build = async () => {
    const models = createModels({
      modelsStore: await modelCatalog(f.directory),
    });
    models.setProvider(withRemoteCatalog(f.faux.provider, 0, fetchCatalog));
    return openAssistant({ ...f, models });
  };
  let runtime = await build();
  try {
    const list = await runtime.request({ type: "models", provider: "test" });
    assert.ok(list.some((model) => model.id === "gpt-6.2-sol"));
    await runtime.request({
      type: "settings_save",
      model: { provider: "test", modelId: "gpt-6.2-sol" },
    });
    await runtime.request({ type: "models", provider: "test" });
    assert.equal(calls, 1);
    await runtime.request({ type: "models_refresh", provider: "test" });
    assert.equal(calls, 2);
    await runtime.close();
    fail = true;
    runtime = await build();
    assert.ok(
      (await runtime.request({ type: "models", provider: "test" })).some(
        (model) => model.id === "gpt-6.2-sol",
      ),
    );
    assert.equal(calls, 2);
    await assert.rejects(
      runtime.request({ type: "models_refresh", provider: "test" }),
      /Unable to refresh/,
    );
    assert.ok(
      (await runtime.request({ type: "models", provider: "test" })).some(
        (model) => model.id === "gpt-6.2-sol",
      ),
    );
  } finally {
    await runtime.close();
  }
});

test("remote catalogs cannot replace newer bundled data or native discovery", async () => {
  const { provider } = fauxProvider({
    provider: "test",
    models: [{ id: "builtin" }],
  });
  const native = { ...provider, refreshModels: async () => {} };
  assert.equal(withRemoteCatalog(native, 0), native);
  const wrapped = withRemoteCatalog(
    provider,
    Date.parse("2026-11-19"),
    async () =>
      Response.json([{ ...provider.getModels()[0], id: "old" }], {
        headers: { "last-modified": "Wed, 18 Nov 2026 12:00:00 GMT" },
      }),
  );
  await wrapped.refreshModels({
    allowNetwork: true,
    signal: new AbortController().signal,
    publish: async ({ update }) => {
      update?.();
      return true;
    },
  });
  assert.deepEqual(
    wrapped.getModels().map((model) => model.id),
    ["builtin"],
  );
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fit-assistant-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let values = {};
  const vault = async (op) => {
    if (op.type === "write") values = structuredClone(op.value);
    return structuredClone(values);
  };
  const faux = fauxProvider({
    provider: "test",
    models: [{ id: "test-model" }],
  });
  const models = createModels();
  models.setProvider(faux.provider);
  return { directory, vault, models, faux };
}
async function settle(runtime, id) {
  const submission = await runtime.harness.submission(id, context);
  return submission.wait(context);
}

test("separate conversations persist, completed request retries do not repeat model calls, defaults reopen", async (t) => {
  const f = await fixture(t);
  f.faux.setResponses([
    fauxAssistantMessage("first answer"),
    fauxAssistantMessage("second answer"),
  ]);
  let runtime = await openAssistant(f);
  try {
    await runtime.request({
      type: "settings_save",
      model: { provider: "test", modelId: "test-model" },
    });
    const a = await runtime.request({ type: "conversation_create" });
    const b = await runtime.request({ type: "conversation_create" });
    const input = {
      type: "conversation_send",
      id: a.id,
      requestId: "first",
      content: "first question",
    };
    const sent = await runtime.request(input);
    assert.equal((await settle(runtime, sent.id)).status, "done");
    const other = await runtime.request({
      ...input,
      id: b.id,
      requestId: "second",
      content: "second question",
    });
    assert.equal((await settle(runtime, other.id)).status, "done");
    await runtime.close();
    runtime = await openAssistant(f);
    assert.equal(
      (await runtime.request({ type: "settings" })).model.modelId,
      "test-model",
    );
    assert.equal(
      (await runtime.request({ type: "conversation_list" })).items.length,
      2,
    );
    assert.equal((await runtime.request(input)).id, sent.id);
    assert.equal(f.faux.state.callCount, 2);
    const aView = JSON.stringify(
      await runtime.request({ type: "conversation_get", id: a.id }),
    );
    const bView = JSON.stringify(
      await runtime.request({ type: "conversation_get", id: b.id }),
    );
    assert.match(aView, /first question/);
    assert.doesNotMatch(aView, /second question/);
    assert.match(bView, /second question/);
    assert.doesNotMatch(bView, /first question/);
  } finally {
    await runtime.close();
  }
});

test("closing mid-turn leaves resumable work; reopening finishes the original submission", async (t) => {
  const f = await fixture(t);
  let started;
  const began = new Promise((resolve) => {
    started = resolve;
  });
  f.faux.setResponses([
    async (_context, options) => {
      started();
      await new Promise((_, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(Error("interrupted")),
          { once: true },
        );
      });
    },
  ]);
  let runtime = await openAssistant(f);
  try {
    const c = await runtime.request({
      type: "conversation_create",
      model: { provider: "test", modelId: "test-model" },
    });
    const sent = await runtime.request({
      type: "conversation_send",
      id: c.id,
      requestId: "resume-test",
      content: "continue me",
    });
    await began;
    await runtime.close();
    f.faux.setResponses([fauxAssistantMessage("resumed answer")]);
    runtime = await openAssistant(f);
    assert.equal((await settle(runtime, sent.id)).status, "done");
    assert.match(
      JSON.stringify(
        await runtime.request({ type: "conversation_get", id: c.id }),
      ),
      /resumed answer/,
    );
  } finally {
    await runtime.close();
  }
});

test("credential updates serialize refresh and preserve failed writes", async () => {
  let values = { test: { type: "api_key", key: "old" } };
  const store = credentialStore(async (op) => {
    if (op.type === "write") values = structuredClone(op.value);
    return structuredClone(values);
  });
  await Promise.all([
    store.modify("test", async (current) => ({
      ...current,
      key: current.key + "1",
    })),
    store.modify("test", async (current) => ({
      ...current,
      key: current.key + "2",
    })),
  ]);
  assert.equal((await store.read("test")).key, "old12");
  assert.deepEqual(await store.list(), [
    { providerId: "test", type: "api_key" },
  ]);
  const failed = credentialStore(async (op) => {
    if (op.type === "write") throw Error("disk full");
    return structuredClone(values);
  });
  await assert.rejects(
    failed.modify("test", async () => ({ type: "api_key", key: "lost" })),
    /disk full/,
  );
  assert.equal((await failed.read("test")).key, "old12");
});

test("provider-neutral login prompts, cancellation and non-secret status", async (t) => {
  const f = await fixture(t);
  f.models.setProvider({
    ...f.faux.provider,
    auth: {
      apiKey: {
        name: "Test API key",
        login: async (interaction) => ({
          type: "api_key",
          key: await interaction.prompt({
            type: "secret",
            message: "API key",
            signal: interaction.signal,
          }),
        }),
        resolve: async ({ credential }) =>
          credential
            ? { auth: { apiKey: credential.key }, source: "Saved key" }
            : undefined,
      },
    },
  });
  // Supply Pi's real Models with the persistent credential adapter, not a substitute auth flow.
  const models = createModels({ credentials: credentialStore(f.vault) });
  models.setProvider(f.models.getProvider("test"));
  const runtime = await openAssistant({ ...f, models });
  try {
    const login = await runtime.request({
      type: "login_start",
      provider: "test",
      method: "api_key",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    let state = await runtime.request({ type: "login_status" });
    assert.equal(state.prompt.type, "secret");
    await runtime.request({
      type: "login_answer",
      id: login.id,
      promptId: state.prompt.id,
      answer: "private-test-key",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    state = await runtime.request({ type: "login_status" });
    assert.equal(state.status, "done");
    assert.doesNotMatch(JSON.stringify(state), /private-test-key/);
    assert.doesNotMatch(
      JSON.stringify(await runtime.request({ type: "settings" })),
      /private-test-key/,
    );
    await runtime.request({
      type: "login_start",
      provider: "test",
      method: "api_key",
    });
    await runtime.request({ type: "login_cancel" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      (await runtime.request({ type: "login_status" })).status,
      "cancelled",
    );
    await assert.rejects(
      runtime.request({
        type: "conversation_create",
        model: { provider: "bad", modelId: "bad" },
      }),
      /Unknown provider/,
    );
  } finally {
    await runtime.close();
  }
});

test("credential vault refuses insecure backend and encrypts before disk persistence", async (t) => {
  const f = await fixture(t);
  const insecure = credentialVault(f.directory, {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "basic_text",
  });
  await assert.rejects(
    insecure.request({ type: "write", value: {} }),
    /unavailable/,
  );
  const safe = credentialVault(f.directory, {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value).map((byte) => byte ^ 85),
    decryptString: (value) =>
      Buffer.from(value)
        .map((byte) => byte ^ 85)
        .toString(),
  });
  await safe.request({
    type: "write",
    value: { test: { type: "api_key", key: "private-test-key" } },
  });
  assert.doesNotMatch(
    (await fs.readFile(path.join(f.directory, "credentials.enc"))).toString(),
    /private-test-key/,
  );
  assert.equal(
    (await safe.request({ type: "read" })).test.key,
    "private-test-key",
  );
});

test(
  "abrupt process exit recovers the admitted submission from SQLite",
  { timeout: 15_000 },
  async (t) => {
    const { fork } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const f = await fixture(t);
    const child = fork(
      fileURLToPath(new URL("./assistant-crash.mjs", import.meta.url)),
      [f.directory],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    let receipt,
      started = false;
    try {
      await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", (code) =>
          reject(Error(`Crash fixture exited early: ${code}`)),
        );
        child.on("message", (message) => {
          if (message.kind === "admitted") receipt = message;
          if (message.kind === "started") started = true;
          if (started && receipt) resolve();
        });
      });
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
      f.faux.setResponses([
        fauxAssistantMessage("recovered after process death"),
      ]);
      const runtime = await openAssistant(f);
      try {
        assert.equal(
          (await settle(runtime, receipt.submission)).status,
          "done",
        );
        const repeated = await runtime.request({
          type: "conversation_send",
          id: receipt.conversation,
          requestId: "crash-retry",
          content: "recover this turn",
        });
        assert.equal(repeated.id, receipt.submission);
        assert.equal(f.faux.state.callCount, 1);
      } finally {
        await runtime.close();
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  },
);

test("OAuth receives the same installation identity after reopening", async (t) => {
  const f = await fixture(t);
  const identities = [];
  const models = createModels({ credentials: credentialStore(f.vault) });
  models.setProvider({
    ...f.faux.provider,
    auth: {
      oauth: {
        name: "Subscription login",
        login: async (_interaction, options) => {
          const id = options.getDeviceId();
          assert.match(id, /^[0-9a-f-]{36}$/);
          identities.push(id);
          return {
            type: "oauth",
            access: "fake-access",
            refresh: "fake-refresh",
            expires: Date.now() + 60_000,
          };
        },
        refresh: async (credential) => credential,
        toAuth: async (credential) => ({ apiKey: credential.access }),
      },
    },
  });
  for (let i = 0; i < 2; i++) {
    const runtime = await openAssistant({ ...f, models });
    try {
      await runtime.request({
        type: "login_start",
        provider: "test",
        method: "oauth",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(
        (await runtime.request({ type: "login_status" })).status,
        "done",
      );
    } finally {
      await runtime.close();
    }
  }
  assert.equal(identities[0], identities[1]);
});

test("conversations share the injected tool registry without sharing their transcripts", async (t) => {
  const { createRegistry, defineExtension, defineTool } = await import(
    "@earendil-works/pi-durable"
  );
  const { fauxToolCall } = await import("@earendil-works/pi-ai/providers/faux");
  const f = await fixture(t);
  let calls = 0;
  const registry = createRegistry();
  registry.install(
    defineExtension({
      name: "test-tools",
      tools: [
        defineTool({
          name: "test_count",
          description: "Synthetic test tool",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          replay: "safe",
          execute: async () => {
            calls++;
            return {};
          },
        }),
      ],
    }),
  );
  f.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("test_count", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("one"),
    fauxAssistantMessage(fauxToolCall("test_count", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("two"),
  ]);
  const runtime = await openAssistant({ ...f, registry });
  try {
    for (const content of [
      "first tool conversation",
      "second tool conversation",
    ]) {
      const c = await runtime.request({
        type: "conversation_create",
        model: { provider: "test", modelId: "test-model" },
      });
      const s = await runtime.request({
        type: "conversation_send",
        id: c.id,
        requestId: content,
        content,
      });
      assert.equal((await settle(runtime, s.id)).status, "done");
    }
    assert.equal(calls, 2);
  } finally {
    await runtime.close();
  }
});

test("dynamic catalog cache survives reopening and deletion", async (t) => {
  const { modelCatalog } = await import("../src/catalog.mjs");
  const f = await fixture(t);
  let store = await modelCatalog(f.directory);
  const entry = {
    models: [{ id: "private-model", name: "Private model" }],
    etag: "version-one",
  };
  await store.write("local/provider", entry);
  store = await modelCatalog(f.directory);
  assert.deepEqual(await store.read("local/provider"), entry);
  await store.delete("local/provider");
  assert.equal(await store.read("local/provider"), undefined);
});

test("default model selection requires authentication for that provider", async (t) => {
  const f = await fixture(t);
  const provider = {
    ...f.faux.provider,
    auth: {
      apiKey: {
        name: "Test credentials",
        resolve: async () => undefined,
      },
    },
  };
  f.models.setProvider(provider);
  const runtime = await openAssistant(f);
  try {
    await assert.rejects(
      runtime.request({
        type: "settings_save",
        model: { provider: "test", modelId: "test-model" },
      }),
      /Connect this provider/,
    );
    assert.equal((await runtime.request({ type: "settings" })).model, null);
    f.models.setProvider(f.faux.provider);
    await runtime.request({
      type: "settings_save",
      model: { provider: "test", modelId: "test-model" },
    });
    assert.equal(
      (await runtime.request({ type: "settings" })).model.modelId,
      "test-model",
    );
  } finally {
    await runtime.close();
  }
});

test("model listing and selection honor provider credential filters", async (t) => {
  const f = await fixture(t);
  const faux = fauxProvider({
    provider: "filtered",
    models: [{ id: "allowed" }, { id: "restricted" }],
  });
  f.models.setProvider({
    ...faux.provider,
    filterModels: (models) => models.filter((model) => model.id === "allowed"),
  });
  const runtime = await openAssistant(f);
  try {
    assert.deepEqual(
      (await runtime.request({ type: "models", provider: "filtered" })).map(
        (model) => model.id,
      ),
      ["allowed"],
    );
    await assert.rejects(
      runtime.request({
        type: "settings_save",
        model: { provider: "filtered", modelId: "restricted" },
      }),
      /not available/,
    );
    await assert.rejects(
      runtime.request({
        type: "conversation_create",
        model: { provider: "filtered", modelId: "restricted" },
      }),
      /not available/,
    );
    f.models.setProvider({
      ...faux.provider,
      auth: { apiKey: { name: "Missing key", resolve: async () => undefined } },
    });
    assert.deepEqual(
      await runtime.request({ type: "models", provider: "filtered" }),
      [],
    );
  } finally {
    await runtime.close();
  }
});

test("ChatGPT sign-in chooses Pi browser login without an extra prompt", async (t) => {
  const f = await fixture(t);
  const models = createModels({ credentials: credentialStore(f.vault) });
  let chosen;
  models.setProvider({
    ...f.faux.provider,
    id: "openai-codex",
    auth: {
      oauth: {
        name: "ChatGPT",
        login: async (interaction) => {
          chosen = await interaction.prompt({
            type: "select",
            message: "Login method",
            options: [
              { id: "browser", label: "Browser" },
              { id: "device_code", label: "Device code" },
            ],
          });
          interaction.notify({
            type: "auth_url",
            url: "https://example.com/login",
          });
          await interaction.prompt({
            type: "text",
            message: "Callback",
            placeholder: "http://localhost:1455/auth/callback",
            signal: interaction.signal,
          });
          throw Error("test cancelled");
        },
        refresh: async (credential) => credential,
        toAuth: async (credential) => ({ apiKey: credential.access }),
      },
    },
  });
  const runtime = await openAssistant({ ...f, models });
  try {
    await runtime.request({
      type: "login_start",
      provider: "openai-codex",
      method: "oauth",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const state = await runtime.request({ type: "login_status" });
    assert.equal(chosen, "browser");
    assert.equal(state.prompt.type, "text");
    assert.equal(state.events[0].type, "auth_url");
    await runtime.request({ type: "login_cancel" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      (await runtime.request({ type: "login_status" })).status,
      "cancelled",
    );
    await runtime.request({
      type: "login_start",
      provider: "openai-codex",
      method: "oauth",
      flow: "device_code",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(chosen, "device_code");
    assert.equal(
      (await runtime.request({ type: "login_status" })).flow,
      "device_code",
    );
    await runtime.request({ type: "login_cancel" });
    await assert.rejects(
      runtime.request({
        type: "login_start",
        provider: "openai-codex",
        method: "oauth",
        flow: "invalid",
      }),
      /Unsupported sign-in flow/,
    );
  } finally {
    await runtime.close();
  }
});

test("specialized conversations send their own instructions to the model, including after reopen", async (t) => {
  const f = await fixture(t);
  const contexts = [];
  const respond = (ctx) => {
    contexts.push(ctx);
    return fauxAssistantMessage("ok");
  };
  f.faux.setResponses([respond, respond, respond]);
  let runtime = await openAssistant(f);
  try {
    const create = (type) =>
      runtime.request({
        type,
        model: { provider: "test", modelId: "test-model" },
      });
    const dish = await create("dish_conversation_create"),
      generic = await create("conversation_create"),
      planning = await create("planning_conversation_create");
    await runtime.close();
    runtime = await openAssistant(f);
    for (const { id } of [dish, generic, planning]) {
      const sent = await runtime.request({
        type: "conversation_send",
        id,
        requestId: "test",
        content: "Hello",
      });
      assert.equal((await settle(runtime, sent.id)).status, "done");
    }
    assert.match(JSON.stringify(contexts[0]), /You are the dish assistant/);
    assert.match(
      JSON.stringify(contexts[2]),
      /Help plan meals for the selected week/,
    );
    assert.doesNotMatch(
      JSON.stringify(contexts[1]),
      /You are the dish assistant/,
    );
  } finally {
    await runtime.close();
  }
});

test("dish editor polls the requested turn across cancellation and later replies", async (t) => {
  const fixtureData = await fixture(t);
  const started = Promise.withResolvers();
  fixtureData.faux.setResponses([
    async (_, { signal }) => {
      started.resolve();
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(Error("cancelled")), {
          once: true,
        }),
      );
    },
    fauxAssistantMessage("second answer"),
  ]);
  const runtime = await openAssistant(fixtureData);
  try {
    const { id } = await runtime.request({
      type: "dish_conversation_create",
      model: { provider: "test", modelId: "test-model" },
    });
    const send = (requestId) =>
      runtime.request({
        type: "conversation_send",
        id,
        requestId,
        content: requestId,
      });
    const poll = (requestId) =>
      runtime.request({ type: "conversation_reply", id, requestId });
    const first = await send("first");
    await started.promise;
    assert.equal((await poll("first")).status, "placed");
    await runtime.request({ type: "conversation_cancel", id });
    await settle(runtime, first.id);
    const second = await send("second");
    await settle(runtime, second.id);
    assert.equal((await poll("first")).status, "unanswered");
    assert.match(
      JSON.stringify((await poll("second")).answer),
      /second answer/,
    );
  } finally {
    await runtime.close();
  }
});
