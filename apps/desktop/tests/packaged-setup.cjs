// Exercise first run through the actual packaged window with disposable stores.
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { openApplicationBridge } = require("../electron/application-bridge.cjs");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const base = path.resolve(__dirname, "..");
  const executablePath =
    process.env.TODU_PACKAGED_EXECUTABLE ||
    (process.platform === "darwin"
      ? path.join(
          base,
          "out",
          process.arch === "arm64" ? "mac-arm64" : "mac",
          "Todu Fit Proof.app/Contents/MacOS/Todu Fit Proof",
        )
      : path.join(base, "out/win-unpacked/Todu Fit Proof.exe"));
  const root = await fs.mkdtemp(
    path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", "fit-ui-"),
  );
  const stores = [];
  const errors = [];
  let app;
  async function launch(name) {
    const data = path.join(root, name);
    const config = path.join(root, `${name}.yaml`);
    stores.push(data);
    await fs.writeFile(
      config,
      `data_dir: ${JSON.stringify(data)}\nsync:\n  auto_sync: false\n`,
    );
    const env = {
      ...process.env,
      FIT_CONFIG: config,
      FIT_DATA_DIR: data,
      TODU_FIT_PROOF_DATA: path.join(root, `${name}-ui`),
    };
    delete env.FIT_DAEMON_ENDPOINT;
    delete env.FIT_SYNC_URL;
    app = await electron.launch({ executablePath, env, timeout: 30000 });
    app.process().stderr?.on("data", (chunk) => process.stderr.write(chunk));
    console.log(`Electron launched: ${name}`);
    const page = await app.firstWindow({ timeout: 30000 });
    page.setDefaultTimeout(30000);
    page.on("pageerror", (e) => errors.push(e.message));
    console.log(`Opened packaged setup window: ${name}`);
    return page;
  }
  async function bridge(name) {
    return openApplicationBridge(
      await fs.readFile(path.join(root, name, "daemon.endpoint"), "utf8"),
    );
  }
  try {
    let page = await launch("new");
    await page.getByRole("heading", { name: "Welcome to Fit" }).waitFor();
    await page.getByLabel("Group name").fill("My test household");
    if (process.env.FIT_SETUP_TEST_SYNC_URL)
      await page
        .getByLabel(/Sync server address/)
        .fill(process.env.FIT_SETUP_TEST_SYNC_URL);
    await page.getByRole("button", { name: "Create my data" }).click();
    await page.getByRole("button", { name: "New dish", exact: true }).waitFor();
    console.log("Closing packaged window");
    await app.close();
    app = null;
    let b = await bridge("new");
    const identity = (await b.request({ type: "identity_get" })).data;
    assert.equal(identity.groups[0].name, "My test household");
    if (process.env.FIT_SETUP_TEST_SYNC_URL) {
      await b.request({ type: "sync_start" });
      const end = Date.now() + 20000;
      while (true) {
        const s = (await b.request({ type: "status" })).data.sync;
        if (s.state === "failed") throw Error(s.message);
        if (s.state === "idle") break;
        assert(Date.now() < end);
        await pause(50);
      }
    }
    await b.close();
    page = await launch("new");
    await page.getByRole("button", { name: "New dish", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("heading", { name: "Welcome to Fit" }).count(),
      0,
    );
    console.log("Closing packaged window");
    await app.close();
    app = null;
    if (process.env.FIT_SETUP_TEST_SYNC_URL) {
      page = await launch("joined");
      await page
        .getByLabel("Connect to existing data", { exact: true })
        .check();
      await page.getByLabel("Root document ID").fill(identity.root_id);
      await page.getByLabel(/Sync server address/).fill("ws://127.0.0.1:1");
      await page.getByRole("button", { name: "Connect and download" }).click();
      await page.getByText(/Setup incomplete:/).waitFor();
      await page
        .getByLabel(/Sync server address/)
        .fill(process.env.FIT_SETUP_TEST_SYNC_URL);
      await page.getByRole("button", { name: "Retry setup" }).click();
      await page
        .getByRole("button", { name: "New dish", exact: true })
        .waitFor();
      b = await bridge("joined");
      assert.equal(
        (await b.request({ type: "setup_status" })).data.completed_documents,
        7,
      );
      assert.equal(
        (await b.request({ type: "identity_get" })).data.root_id,
        identity.root_id,
      );
      await b.close();
    }
    await fs.mkdir(path.join(base, "test-results"), { recursive: true });
    await fs.writeFile(
      path.join(base, "test-results/setup.json"),
      JSON.stringify(
        {
          passed: true,
          existingRootTest: !!process.env.FIT_SETUP_TEST_SYNC_URL,
          errors,
        },
        null,
        2,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS packaged first-run setup, daemon survival, reopen, and configured join checks",
    );
  } finally {
    if (app) await app.close();
    for (const data of new Set(stores)) {
      try {
        process.kill(
          Number(await fs.readFile(path.join(data, "daemon.pid"), "utf8")),
        );
      } catch (e) {
        if (!["ENOENT", "ESRCH"].includes(e.code)) throw e;
      }
    }
    await pause(250);
    await fs.rm(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
