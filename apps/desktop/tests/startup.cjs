const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { connectOrStart } = require("../electron/daemon-startup.cjs");
const { openApplicationBridge } = require("../electron/application-bridge.cjs");
const binary =
  process.env.FIT_TEST_BINARY ||
  path.resolve(
    __dirname,
    "../daemon",
    process.platform === "win32" ? "fit.exe" : "fit",
  );
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function fresh() {
  const root = await fs.mkdtemp(
    path.join(
      process.platform === "win32" ? os.tmpdir() : "/tmp",
      "fit-start-",
    ),
  );
  const data = path.join(root, "data");
  const config = path.join(root, "config.yaml");
  await fs.writeFile(
    config,
    `data_dir: ${JSON.stringify(data)}\nsync:\n  auto_sync: false\n`,
  );
  const env = { ...process.env, FIT_DATA_DIR: data };
  delete env.FIT_SYNC_URL;
  const options = {
    binary,
    config,
    env,
    logPath: path.join(root, "startup.log"),
  };
  return {
    root,
    data,
    options,
    close: async () => {
      try {
        const pid = Number(
          await fs.readFile(path.join(data, "daemon.pid"), "utf8"),
        );
        process.kill(pid);
      } catch (e) {
        if (!["ENOENT", "ESRCH"].includes(e.code)) throw e;
      }
      await pause(150);
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
async function finish(bridge) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const { data } = await bridge.request({ type: "setup_status" });
    if (data.state !== "running") return data;
    await pause(20);
  }
  throw new Error("Setup timed out");
}
test("simultaneous desktop launches share one owner; setup retries and reconnect preserve identity", async () => {
  const f = await fresh();
  let bridge;
  try {
    const endpoints = await Promise.all(
      Array.from({ length: 4 }, () => connectOrStart(f.options)),
    );
    assert.equal(new Set(endpoints).size, 1);
    bridge = openApplicationBridge(endpoints[0]);
    assert.equal(
      (await bridge.request({ type: "setup_status" })).data.state,
      "required",
    );
    const id = randomUUID();
    const operation = {
      type: "setup_start",
      root_id: null,
      server_url: null,
      group_name: "Household",
    };
    await bridge.request(operation, id);
    assert.equal((await finish(bridge)).state, "ready");
    const identity = (await bridge.request({ type: "identity_get" })).data;
    assert.equal(identity.groups.length, 1);
    assert.equal((await bridge.request(operation, id)).data.state, "ready");
    await assert.rejects(
      bridge.request({ ...operation, group_name: "Different" }, id),
      /RETRY_CONFLICT/,
    );
    await assert.rejects(bridge.request(operation), /already has an identity/);
    await bridge.close();
    const endpoint = await connectOrStart(f.options);
    bridge = openApplicationBridge(endpoint);
    assert.equal(
      (await bridge.request({ type: "identity_get" })).data.root_id,
      identity.root_id,
    );
    assert.equal(
      (await bridge.request({ type: "shopping_list", week: "2026-11-01" }))
        .type,
      "shopping",
    );
  } finally {
    await bridge?.close();
    await f.close();
  }
});
test("failed join stays uninitialized and can retry without replacing data", async () => {
  const f = await fresh();
  let bridge;
  try {
    bridge = openApplicationBridge(await connectOrStart(f.options));
    await bridge.request({
      type: "setup_start",
      root_id: "2i6KmWQkkfQdFhXC9n65UZshA7eQ",
      server_url: "ws://127.0.0.1:1",
      group_name: null,
    });
    const state = await finish(bridge);
    assert.equal(state.state, "failed");
    assert.match(state.message, /Setup incomplete/);
    assert.equal(
      (await bridge.request({ type: "identity_get" })).data.state,
      "uninitialized",
    );
    await bridge.request({
      type: "setup_start",
      root_id: null,
      server_url: null,
      group_name: "Local",
    });
    assert.equal((await finish(bridge)).state, "ready");
  } finally {
    await bridge?.close();
    await f.close();
  }
});
test("startup failure is bounded and preserves legacy storage", async () => {
  const f = await fresh();
  try {
    await fs.mkdir(f.data);
    await fs.writeFile(path.join(f.data, "legacy"), "preserve");
    await assert.rejects(
      connectOrStart({ ...f.options, timeoutMs: 700 }),
      /did not become ready/,
    );
    assert.equal(
      await fs.readFile(path.join(f.data, "legacy"), "utf8"),
      "preserve",
    );
  } finally {
    await f.close();
  }
});
module.exports = { fresh, finish };
test(
  "fresh setup syncs empty storage and existing-root join downloads every reference",
  { skip: !process.env.FIT_SETUP_TEST_SYNC_URL },
  async () => {
    const first = await fresh(),
      second = await fresh();
    let a, b;
    try {
      a = openApplicationBridge(await connectOrStart(first.options));
      b = openApplicationBridge(await connectOrStart(second.options));
      const server_url = process.env.FIT_SETUP_TEST_SYNC_URL;
      await a.request({
        type: "setup_start",
        root_id: null,
        server_url,
        group_name: "Shared",
      });
      assert.equal((await finish(a)).state, "ready");
      await a.request({ type: "sync_start" });
      const deadline = Date.now() + 15000;
      while (true) {
        const state = (await a.request({ type: "status" })).data.sync;
        if (state.state === "failed") throw Error(state.message);
        if (state.state === "idle") break;
        assert(Date.now() < deadline, "sync deadline");
        await pause(30);
      }
      const root_id = (await a.request({ type: "identity_get" })).data.root_id;
      await b.request({
        type: "setup_start",
        root_id: "2i6KmWQkkfQdFhXC9n65UZshA7eQ",
        server_url,
        group_name: null,
      });
      assert.equal((await finish(b)).state, "failed");
      assert.equal(
        (await b.request({ type: "identity_get" })).data.state,
        "uninitialized",
      );
      await b.request({
        type: "setup_start",
        root_id,
        server_url,
        group_name: null,
      });
      const state = await finish(b);
      assert.equal(state.state, "ready", state.message);
      assert.equal(state.completed_documents, 7);
      assert.equal(
        (await b.request({ type: "identity_get" })).data.root_id,
        root_id,
      );
      assert.equal(
        (await b.request({ type: "config_get" })).data.sync_server_url,
        server_url,
      );
      assert.equal((await b.request({ type: "dishes_list" })).data.length, 0);
      await b.close();
      process.kill(
        Number(await fs.readFile(path.join(second.data, "daemon.pid"), "utf8")),
      );
      await pause(200);
      b = openApplicationBridge(await connectOrStart(second.options));
      assert.equal(
        (await b.request({ type: "setup_status" })).data.state,
        "ready",
      );
      assert.equal(
        (await b.request({ type: "config_get" })).data.sync_server_url,
        server_url,
      );
    } finally {
      await a?.close();
      await b?.close();
      await first.close();
      await second.close();
    }
  },
);

test(
  "live sync exchanges commits and catches up after reconnect without polling",
  { skip: !process.env.FIT_SETUP_TEST_SYNC_URL, timeout: 55000 },
  async () => {
    const net = require("node:net");
    const server = new URL(process.env.FIT_SETUP_TEST_SYNC_URL);
    assert.equal(server.protocol, "ws:", "Test needs a disposable ws server");
    const sockets = new Set();
    let online = true;
    let connections = 0;
    const proxy = net.createServer((client) => {
      if (!online) {
        client.destroy();
        return;
      }
      connections++;
      const upstream = net.connect(Number(server.port) || 80, server.hostname);
      sockets.add(client);
      client.on("error", () => upstream.destroy());
      upstream.on("error", () => client.destroy());
      client.on("close", () => {
        sockets.delete(client);
        upstream.destroy();
      });
      upstream.on("close", () => client.destroy());
      client.pipe(upstream).pipe(client);
    });
    await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const first = await fresh();
    const second = await fresh();
    let a, b;
    async function eventually(check, message) {
      const deadline = Date.now() + 6000;
      do {
        if (await check()) return;
        await pause(50);
      } while (Date.now() < deadline);
      assert.fail(message);
    }
    const hasDish = async (bridge, name) =>
      (await bridge.request({ type: "dishes_list" })).data.some(
        (dish) => dish.name === name,
      );
    try {
      a = openApplicationBridge(await connectOrStart(first.options));
      b = openApplicationBridge(await connectOrStart(second.options));
      await a.request({
        type: "setup_start",
        root_id: null,
        server_url: `ws://127.0.0.1:${proxy.address().port}`,
        group_name: "Live sync",
      });
      assert.equal((await finish(a)).state, "ready");
      const { root_id } = (await a.request({ type: "identity_get" })).data;
      await eventually(async () => {
        await b.request({
          type: "setup_start",
          root_id,
          server_url: server.href,
          group_name: null,
        });
        return (await finish(b)).state === "ready";
      }, "Fresh identity was not published automatically");

      await a.request({ type: "dish_create", name: "First commit" });
      await eventually(() => hasDish(b, "First commit"), "Commit did not reach peer");
      await b.request({ type: "dish_create", name: "Peer commit" });
      await eventually(() => hasDish(a, "Peer commit"), "Peer commit did not arrive");
      assert.equal(connections, 1);
      const revision = (await a.request({ type: "status" })).data.revision;
      await pause(31000);
      assert.equal(connections, 1, "Idle sync opened another connection");
      assert.equal((await a.request({ type: "status" })).data.revision, revision);

      online = false;
      for (const socket of sockets) socket.destroy();
      await eventually(async () =>
        (await a.request({ type: "status" })).data.sync.state === "failed",
        "Disconnect was not reported",
      );
      await a.request({ type: "sync_start" });
      await eventually(async () =>
        (await a.request({ type: "status" })).data.sync.state === "failed",
        "Manual sync failure was not reported",
      );
      await a.request({ type: "dish_create", name: "Offline local commit" });
      await b.request({ type: "dish_create", name: "Offline peer commit" });
      online = true;
      await eventually(() => hasDish(a, "Offline peer commit"), "Reconnect did not catch up");
      await eventually(() => hasDish(b, "Offline local commit"), "Reconnect did not publish local edit");
      assert.equal((await a.request({ type: "status" })).data.sync.state, "idle");
      assert.equal(connections, 2);
    } finally {
      await a?.close();
      await b?.close();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => proxy.close(resolve));
      await first.close();
      await second.close();
    }
  },
);
