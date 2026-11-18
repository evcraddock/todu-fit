const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { credentialVault } = require("./credentials.cjs");
const exec = promisify(execFile);

function createAssistantHost({
  directory,
  legacyDirectory,
  bundle,
  safeStorage,
  shell,
}) {
  let starting,
    closed = false;
  const client = import(
    pathToFileURL(path.join(bundle, "src/protocol.mjs")).href
  );
  async function send(operation) {
    return (await client).request(directory, operation);
  }
  async function start() {
    if (!starting)
      starting = (async () => {
        const binary = path.join(
          bundle,
          process.platform === "win32" ? "node.exe" : "node",
        );
        await exec(
          binary,
          [path.join(bundle, "src/launcher.mjs"), directory, legacyDirectory],
          {
            timeout: 30000,
            maxBuffer: 1024 * 1024,
            windowsHide: true,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
          },
        );
        const status = await send({ type: "worker_status" });
        if (status.credentialsPending) {
          const marker = JSON.parse(
            await fs.readFile(path.join(directory, "migration.json"), "utf8"),
          );
          if (path.resolve(marker.source) !== path.resolve(legacyDirectory))
            throw Error(
              "Legacy assistant profile does not match this desktop profile",
            );
          const legacy = credentialVault(legacyDirectory, safeStorage);
          await send({
            type: "credentials_import",
            credentials: await legacy.request({ type: "read" }),
          });
        }
      })().catch((error) => {
        starting = undefined;
        throw error;
      });
    return starting;
  }
  return {
    start,
    async request(operation) {
      if (closed) throw Error("Assistant client is closed");
      if (
        !operation ||
        typeof operation !== "object" ||
        JSON.stringify(operation).length > 150000
      )
        throw Error("Invalid assistant request");
      // Migration and lifecycle are host/CLI operations, never renderer capabilities.
      if (
        ["credentials_import", "worker_stop", "worker_status"].includes(
          operation.type,
        )
      )
        throw Error("Operation denied");
      if (operation.type === "worker_restart") {
        const status = await send({ type: "worker_status" });
        await send({ type: "worker_stop" });
        const deadline = Date.now() + 10000;
        while (true) {
          try {
            process.kill(status.pid, 0);
          } catch (error) {
            if (error.code === "ESRCH") break;
            throw error;
          }
          if (Date.now() >= deadline)
            throw Error("AI worker is still stopping. Try again shortly.");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        starting = undefined;
        await start();
        return null;
      }
      await start();
      if (operation.type === "login_open_link") {
        const state = await send({ type: "login_status" });
        const links = (state?.events ?? [])
          .flatMap((e) => [
            e.url,
            e.verificationUri,
            ...(e.links ?? []).map((l) => l.url),
          ])
          .filter(Boolean);
        if (state?.status !== "pending" || !links.includes(operation.url))
          throw Error("Sign-in link expired");
        const url = new URL(operation.url);
        if (
          url.protocol !== "https:" &&
          !(
            url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
          )
        )
          throw Error("Unsupported sign-in link");
        await shell.openExternal(url.href);
        return null;
      }
      try {
        return await send(operation);
      } catch (error) {
        // A later request may restart a crashed worker. Do not replay an uncertain
        // mutation here; callers retain Pi request IDs for explicit retries.
        starting = undefined;
        throw error;
      }
    },
    async close() {
      closed = true; /* The shared service outlives this client. */
    },
  };
}
module.exports = { createAssistantHost };
