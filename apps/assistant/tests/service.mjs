import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { serve } from "../src/server.mjs";
import { request, readEndpoint } from "../src/protocol.mjs";
import { createVault } from "../src/vault.mjs";
import { migrate, finishMigration } from "../src/migrate.mjs";
const exec = promisify(execFile);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fit-worker-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
async function eventually(fn) {
  let last;
  for (let i = 0; i < 100; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await pause(50);
    }
  }
  throw last;
}
const memoryVault = () => ({
  available: async () => true,
  exists: async () => false,
  request: async () => ({}),
});

test("worker survives client exit, retains one owner, and resumes after process failure", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fit-worker-"));
  const fixture = fileURLToPath(
    new URL("./service-child.mjs", import.meta.url),
  );
  const children = [];
  t.after(async () => {
    await Promise.all(
      children.map(async (child) => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await exited;
      }),
    );
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const launch = () => {
    const child = spawn(process.execPath, [fixture, directory], {
      stdio: "ignore",
    });
    children.push(child);
    return child;
  };
  const owner = launch();
  await eventually(() => request(directory, { type: "worker_status" }, 500));
  const endpoint = await readEndpoint(directory);
  const loser = launch();
  const losingExit = await new Promise((resolve) =>
    loser.once("exit", resolve),
  );
  assert.equal(losingExit, 1);
  assert.equal((await readEndpoint(directory)).pid, endpoint.pid);
  await request(directory, {
    type: "settings_save",
    model: { provider: "test", modelId: "test-model" },
  });
  const conversation = await request(directory, {
    type: "conversation_create",
  });
  const protocol = new URL("../src/protocol.mjs", import.meta.url).href;
  // A separate client exits immediately after durable admission.
  await exec(process.execPath, [
    "--input-type=module",
    "-e",
    `import {request} from ${JSON.stringify(protocol)}; await request(process.argv[1], {type:'conversation_send', id:Number(process.argv[2]), requestId:'detached', content:'work'});`,
    directory,
    String(conversation.id),
  ]);
  await eventually(async () =>
    assert.match(
      JSON.stringify(
        await request(directory, {
          type: "conversation_get",
          id: conversation.id,
        }),
      ),
      /completed without a client/,
    ),
  );
  const second = await request(directory, { type: "conversation_create" });
  const operation = {
    type: "conversation_send",
    id: second.id,
    requestId: "crash",
    content: "resume",
  };
  const submission = await request(directory, operation);
  owner.kill("SIGKILL");
  await new Promise((resolve) => owner.once("exit", resolve));
  launch();
  await eventually(async () => {
    const s = await request(directory, { type: "worker_status" }, 500);
    assert.notEqual(s.pid, endpoint.pid);
  });
  await eventually(async () =>
    assert.match(
      JSON.stringify(
        await request(directory, { type: "conversation_get", id: second.id }),
      ),
      /completed without a client/,
    ),
  );
  assert.equal((await request(directory, operation)).id, submission.id);
  await request(directory, { type: "worker_stop" });
  await eventually(async () =>
    assert.rejects(fs.access(path.join(directory, "worker.endpoint"))),
  );
});

test("local protocol rejects unauthenticated requests without dispatch", async (t) => {
  const directory = await temporary(t);
  let calls = 0;
  const service = await serve({
    directory,
    vault: memoryVault(),
    openRuntime: async () => ({
      request: async () => ++calls,
      close: async () => {},
    }),
  });
  t.after(() => service.close());
  const endpoint = await readEndpoint(directory);
  await new Promise((resolve, reject) => {
    const socket = net.createConnection(
      { host: "127.0.0.1", port: endpoint.port },
      () =>
        socket.write(
          JSON.stringify({
            protocol: 1,
            id: "x",
            token: "wrong",
            operation: { type: "settings" },
          }) + "\n",
        ),
    );
    socket.on("error", reject);
    socket.on("close", resolve);
  });
  assert.equal(calls, 0);
  await Promise.all(
    Array.from({ length: 60 }, () => request(directory, { type: "test" })),
  );
  assert.equal(calls, 60);
  assert.equal(await request(directory, { type: "test" }), 61);
  if (process.platform !== "win32")
    assert.equal(
      (await fs.stat(path.join(directory, "worker.endpoint"))).mode & 0o777,
      0o600,
    );
  await service.close();
});

test("vault encrypts with OS-held key and refuses unavailable keychain", async (t) => {
  const directory = await temporary(t);
  let key;
  const entry = {
    getPassword: async () => key,
    setPassword: async (v) => {
      key = v;
    },
  };
  const vault = createVault(directory, entry);
  await vault.request({
    type: "write",
    value: { test: { type: "api_key", key: "never-plaintext" } },
  });
  assert.doesNotMatch(
    await fs.readFile(path.join(directory, "credentials.v1.json"), "utf8"),
    /never-plaintext/,
  );
  assert.equal(
    (await createVault(directory, entry).request({ type: "read" })).test.key,
    "never-plaintext",
  );
  const locked = createVault(directory, {
    getPassword: async () => {
      throw Error("locked");
    },
  });
  assert.equal(await locked.available(), false);
  await assert.rejects(
    locked.request({ type: "read" }),
    /secure credential storage/,
  );
  await assert.rejects(
    locked.request({ type: "write", value: {} }),
    /secure credential storage/,
  );
});

test("legacy migration preserves conversations and original encrypted credentials", async (t) => {
  const root = await temporary(t),
    legacy = path.join(root, "old"),
    directory = path.join(root, "new");
  await fs.mkdir(legacy);
  await fs.mkdir(directory);
  await fs.writeFile(
    path.join(legacy, "installation.json"),
    '{"id":"unchanged"}',
  );
  await fs.writeFile(
    path.join(legacy, "settings.json"),
    '{"model":{"provider":"test","modelId":"one"}}',
  );
  await fs.writeFile(
    path.join(legacy, "credentials.enc"),
    "opaque legacy ciphertext",
  );
  const db = new DatabaseSync(path.join(legacy, "conversations.sqlite"));
  db.exec(
    "CREATE TABLE progress(value TEXT); INSERT INTO progress VALUES ('retained')",
  );
  db.close();
  await migrate(directory, legacy);
  await finishMigration(directory);
  await migrate(directory, legacy);
  const copy = new DatabaseSync(path.join(directory, "conversations.sqlite"));
  assert.equal(
    copy.prepare("SELECT value FROM progress").get().value,
    "retained",
  );
  copy.close();
  assert.equal(
    JSON.parse(
      await fs.readFile(path.join(directory, "migration.json"), "utf8"),
    ).credentialsPending,
    true,
  );
  assert.equal(
    await fs.readFile(path.join(legacy, "credentials.enc"), "utf8"),
    "opaque legacy ciphertext",
  );
});

test("pending legacy credentials gate runtime until a successful one-time import", async (t) => {
  const directory = await temporary(t);
  await fs.writeFile(
    path.join(directory, "migration.json"),
    JSON.stringify({
      source: "/legacy",
      staged: false,
      credentialsPending: true,
    }),
  );
  let stored,
    opened = 0,
    unlocked = false;
  const service = await serve({
    directory,
    vault: {
      available: async () => unlocked,
      exists: async () => Boolean(stored),
      request: async (op) => {
        if (!unlocked) throw Error("locked");
        stored = op.value;
      },
    },
    openRuntime: async () => {
      opened++;
      return {
        request: async () => ({ providers: [] }),
        close: async () => {},
      };
    },
  });
  try {
    assert.equal(opened, 0);
    await assert.rejects(
      request(directory, { type: "settings" }),
      /Open the desktop app/,
    );
    const operation = {
      type: "credentials_import",
      credentials: { test: { type: "api_key", key: "test-only" } },
    };
    await assert.rejects(request(directory, operation), /locked/);
    assert.equal(
      (await request(directory, { type: "worker_status" })).credentialsPending,
      true,
    );
    unlocked = true;
    await request(directory, operation);
    assert.equal(opened, 1);
    assert.equal(stored.test.key, "test-only");
    assert.equal(
      (await request(directory, { type: "worker_status" })).credentialsPending,
      false,
    );
    await assert.rejects(
      request(directory, operation),
      /No credential migration/,
    );
  } finally {
    await service.close();
  }
});

test("migration accepts an interrupted first launch without a database but rejects corruption", async (t) => {
  const root = await temporary(t);
  const legacy = path.join(root, "legacy"),
    directory = path.join(root, "shared");
  await fs.mkdir(legacy);
  await fs.mkdir(directory);
  await fs.writeFile(
    path.join(legacy, "installation.json"),
    '{"id":"preserved"}',
  );
  await migrate(directory, legacy);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(directory, "installation.json"))).id,
    "preserved",
  );
  await fs.writeFile(
    path.join(legacy, "conversations.sqlite"),
    "corrupt database",
  );
  const invalid = path.join(root, "invalid");
  await fs.mkdir(invalid);
  await assert.rejects(migrate(invalid, legacy));
  await assert.rejects(fs.access(path.join(invalid, "migration.json")));
});
