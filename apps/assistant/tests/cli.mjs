import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { request } from "../src/protocol.mjs";
const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const binary =
  process.env.FIT_TEST_BINARY ||
  path.join(
    root,
    "apps/desktop/daemon",
    process.platform === "win32" ? "fit.exe" : "fit",
  );
test("Rust CLI launches and shares the independent packaged Node service", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fit-ai-cli-"));
  const profile = path.join(directory, "assistant");
  const config = path.join(directory, "config.yaml");
  await fs.writeFile(
    config,
    `data_dir: ${JSON.stringify(path.join(directory, "nutrition"))}\nsync:\n  auto_sync: false\n`,
  );
  const env = {
    ...process.env,
    FIT_ASSISTANT_DIR: profile,
    FIT_ASSISTANT_BUNDLE: path.join(root, "apps/desktop/assistant-worker"),
    OPENAI_API_KEY: "test-only-not-sent",
  };
  const cli = async (...args) =>
    JSON.parse(
      (
        await exec(binary, ["-c", config, "ai", ...args], {
          env,
          timeout: 35000,
        })
      ).stdout,
    );
  try {
    const legacy = path.join(directory, "legacy");
    await fs.mkdir(legacy);
    await fs.writeFile(path.join(legacy, "installation.json"), "{}");
    await assert.rejects(
      exec(binary, ["-c", config, "ai", "worker", "start"], {
        env: { ...env, FIT_ASSISTANT_LEGACY_DIR: legacy },
      }),
      /Open the updated desktop app/,
    );
    await assert.rejects(fs.access(path.join(profile, "worker.endpoint")));
    const first = await cli("worker", "start");
    const second = await cli("worker", "start");
    assert.equal(first.pid, second.pid);
    const fromNode = await request(profile, { type: "worker_status" });
    assert.equal(first.pid, fromNode.pid);
    const catalog = await cli("models", "openai");
    assert.ok(catalog.length > 0);
    await cli("model", "openai", catalog[0].id);
    assert.equal(
      (await request(profile, { type: "settings" })).model.modelId,
      catalog[0].id,
    );
    assert.ok(Array.isArray((await cli("task", "list")).items));
    await assert.rejects(
      fs.access(path.join(directory, "nutrition", "daemon.sqlite")),
    );
    await cli("worker", "stop");
    for (let i = 0; i < 100; i++) {
      try {
        process.kill(first.pid, 0);
      } catch (e) {
        if (e.code === "ESRCH") break;
        throw e;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  } finally {
    try {
      await request(profile, { type: "worker_stop" });
    } catch {
      /* Already stopped. */
    }
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

test("desktop explicitly upgrades an old shared worker and leaves it running on client close", async () => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const { createRequire } = await import("node:module");
  const { createAssistantHost } = createRequire(import.meta.url)(
    "../../desktop/electron/assistant/host.cjs",
  );
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fit-ai-upgrade-"));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./service-child.mjs", import.meta.url)), directory],
    { stdio: "ignore" },
  );
  let host;
  try {
    let status;
    for (let i = 0; i < 100; i++) {
      try {
        status = await request(directory, { type: "worker_status" });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    assert.equal(status.pid, child.pid);
    host = createAssistantHost({
      directory,
      legacyDirectory: path.join(directory, "legacy"),
      bundle: path.join(root, "apps/desktop/assistant-worker"),
    });
    await assert.rejects(host.start(), /Assistant update is ready/);
    await host.request({ type: "worker_restart" });
    const updated = await request(directory, { type: "worker_status" });
    assert.notEqual(updated.pid, child.pid);
    assert.notEqual(updated.version, "development");
    await host.close();
    assert.equal(
      (await request(directory, { type: "worker_status" })).pid,
      updated.pid,
    );
  } finally {
    await host?.close();
    await createRequire(import.meta.url)(
      "../../desktop/tests/assistant-cleanup.cjs",
    ).stopWorker(directory);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});
