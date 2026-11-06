const fs = require("node:fs"),
  fsp = require("node:fs/promises"),
  http = require("node:http"),
  path = require("node:path");
// Local-only harness; requires the existing sync server and a built desktop.
if (process.env.CI) throw Error("Live UI checks are local-only");
const base = path.resolve(__dirname, "..");
const { _electron: electron } = require(
  base + "/apps/desktop/node_modules/playwright",
);
const { connectOrStart } = require(
  base + "/apps/desktop/electron/daemon-startup.cjs",
);
const { openApplicationBridge } = require(
  base + "/apps/desktop/electron/application-bridge.cjs",
);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { pathToFileURL } = require("node:url");
  const { Repo } = await import(
    pathToFileURL(
      require.resolve(base + "/web/node_modules/@automerge/automerge-repo"),
    )
  );
  const A = await import(
    pathToFileURL(
      base +
        "/web/node_modules/@automerge/automerge/dist/mjs/entrypoints/fullfat_node.js",
    )
  );
  const { WebSocketClientAdapter } = await import(
    pathToFileURL(
      require.resolve(
        base + "/web/node_modules/@automerge/automerge-repo-network-websocket",
      ),
    )
  );
  const repo = new Repo({
    network: [new WebSocketClientAdapter("ws://127.0.0.1:8080")],
    sharePolicy: async () => true,
  });
  const docs = {};
  for (const name of ["dishes", "plans", "logs", "water", "shopping"])
    docs[name] = repo.import(
      fs.readFileSync(
        base + "/todu-fit-core/tests/fixtures/ios-0.7.2-" + name + ".automerge",
      ),
    );
  const imm = (x) => new A.ImmutableString(x);
  const group = repo.create({
    data: imm(
      JSON.stringify({
        schema_version: 2,
        name: "Live iOS compatibility",
        dishes_doc_id: docs.dishes.documentId,
        mealplans_doc_id: docs.plans.documentId,
        shopping_carts_doc_id: docs.shopping.documentId,
      }),
    ),
  });
  const root = repo.create({
    data: imm(
      JSON.stringify({
        schema_version: 2,
        meallogs_doc_id: docs.logs.documentId,
        hydration_doc_id: docs.water.documentId,
        groups: [{ name: "Live iOS compatibility", doc_id: group.documentId }],
      }),
    ),
  });
  const dir = await fsp.mkdtemp("/tmp/fit-live-compat-");
  const config = dir + "/config.yaml";
  await fsp.writeFile(
    config,
    `data_dir: ${dir}/data\nsync:\n  auto_sync: false\n`,
  );
  const env = { ...process.env, FIT_DATA_DIR: dir + "/data" };
  delete env.FIT_SYNC_URL;
  delete env.FIT_DAEMON_ENDPOINT;
  const endpoint = await connectOrStart({
    binary: base + "/target/debug/fit",
    config,
    env,
    logPath: dir + "/daemon.log",
  });
  const b = openApplicationBridge(endpoint);
  await pause(1500);
  await b.request({
    type: "setup_start",
    root_id: root.documentId,
    server_url: "ws://127.0.0.1:8080",
    group_name: null,
  });
  for (let i = 0; i < 80; i++) {
    const s = (await b.request({ type: "setup_status" })).data;
    if (s.state === "ready") break;
    if (s.state === "failed") throw Error(JSON.stringify(s));
    await pause(250);
  }
  if ((await b.request({ type: "setup_status" })).data.state !== "ready")
    throw Error("Setup timed out");
  const app = await electron.launch({
    executablePath:
      process.env.FIT_DESKTOP_BINARY ||
      base +
        "/apps/desktop/out/mac-arm64/Todu Fit Proof.app/Contents/MacOS/Todu Fit Proof",
    env: {
      ...env,
      FIT_DAEMON_ENDPOINT: endpoint,
      TODU_FIT_PROOF_DATA: dir + "/ui",
    },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const info = { root: root.documentId, dir };
  fs.writeFileSync("/tmp/fit-live-info.json", JSON.stringify(info));
  const sync = async () => {
    await b.request({ type: "sync_start" });
    for (let i = 0; i < 80; i++) {
      const s = (await b.request({ type: "status" })).data.sync;
      if (s.state === "failed") throw Error(JSON.stringify(s));
      if (s.state === "idle") return;
      await pause(100);
    }
    throw Error("Sync timeout");
  };
  const nav = async (n) =>
    page
      .getByRole("navigation")
      .getByRole("button", { name: n, exact: true })
      .click();
  http
    .createServer(async (req, res) => {
      try {
        let out = info;
        if (req.url === "/state") {
          await sync();
          out = {
            plans: (
              await b.request({
                type: "plans_list",
                from: "2026-11-01",
                to: "2026-11-30",
              })
            ).data,
            logs: (
              await b.request({
                type: "meals_history",
                from: "2026-11-01",
                to: "2026-11-30",
              })
            ).data,
            water: (await b.request({ type: "water_today" })).data,
          };
          fs.writeFileSync(
            dir + "/latest-state.json",
            JSON.stringify(out, null, 2),
          );
        }
        if (req.url === "/desktop-edit") {
          await sync();
          await page.reload();
          await nav("Meal plans");
          await page.getByText("iOS live dinner", { exact: true }).click();
          await page
            .getByRole("button", { name: "Edit plan", exact: true })
            .click();
          await page
            .getByLabel("Title", { exact: true })
            .fill("Desktop live dinner");
          await page
            .getByRole("button", { name: "Save meal plan", exact: true })
            .click();
          await page
            .getByRole("heading", { name: "Desktop live dinner", exact: true })
            .waitFor();
          await nav("Food log");
          await page
            .getByRole("button", { name: "Edit log", exact: true })
            .click();
          await page.locator("textarea").fill("Desktop live log");
          await page.getByLabel("iOS fixture soup servings").fill("0.75");
          await page
            .getByRole("button", { name: "Save meal log", exact: true })
            .click();
          await page.getByText("Desktop live log", { exact: true }).waitFor();
          const before = (await b.request({ type: "water_today" })).data.days[0]
            .total_ml;
          await nav("Water");
          await page.getByLabel("Water amount").fill("500");
          await page
            .getByRole("button", { name: "Add water", exact: true })
            .click();
          await page
            .getByRole("heading", {
              name: `${before + 500} mL today`,
              exact: true,
            })
            .waitFor();
          await page.screenshot({ path: dir + "/desktop-live.png" });
          await sync();
          out = { ok: true, total: before + 500 };
        }
        if (!["/", "/state", "/desktop-edit"].includes(req.url)) {
          res.writeHead(404).end();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(out));
      } catch (e) {
        console.error(e);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message }));
      }
    })
    .listen(18768, "127.0.0.1");
  console.log(info);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
