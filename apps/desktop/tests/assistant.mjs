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
import {
  openAssistant,
  credentialStore,
} from "../electron/assistant/runtime.mjs";
import { credentialVault } from "../electron/assistant/credentials.cjs";

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
  const { modelCatalog } = await import("../electron/assistant/catalog.mjs");
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
