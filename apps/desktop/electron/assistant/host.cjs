const path = require("node:path");
const { credentialVault } = require("./credentials.cjs");

function createAssistantHost({
  directory,
  utilityProcess,
  safeStorage,
  shell,
}) {
  const vault = credentialVault(directory, safeStorage);
  let worker,
    ready,
    unavailable,
    closing = false,
    sequence = 0;
  const pending = new Map();
  function start() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      worker = utilityProcess.fork(path.join(__dirname, "worker.mjs"), [], {
        serviceName: "todufit assistant",
        stdio: "pipe",
      });
      // Avoid provider diagnostics/credentials in application logs.
      worker.stdout?.resume();
      worker.stderr?.resume();
      const timer = setTimeout(() => {
        reject(Error("Assistant startup timed out"));
        worker.kill();
      }, 20_000);
      const fail = (error) => {
        clearTimeout(timer);
        unavailable = error;
        reject(error);
        for (const waiter of pending.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(error);
        }
        pending.clear();
      };
      worker.on("error", () =>
        fail(Error("Assistant process failed. Reopen the app to resume.")),
      );
      worker.on("exit", () =>
        fail(Error("Assistant stopped. Reopen the app to resume saved work.")),
      );
      worker.on("message", async (message) => {
        if (message.kind === "ready") {
          clearTimeout(timer);
          resolve();
        } else if (message.kind === "failed")
          fail(
            Error(
              "Unable to open assistant storage. Check available disk space and reopen the app.",
            ),
          );
        else if (message.kind === "vault") {
          try {
            worker.postMessage({
              kind: "vault_result",
              id: message.id,
              value: await vault.request(message.operation),
            });
          } catch {
            worker.postMessage({
              kind: "vault_result",
              id: message.id,
              error: "Unable to access secure credential storage.",
            });
          }
        } else if (message.kind === "result") {
          const waiter = pending.get(message.id);
          pending.delete(message.id);
          if (waiter) {
            clearTimeout(waiter.timer);
            message.error
              ? waiter.reject(Error(message.error))
              : waiter.resolve(message.value);
          }
        }
      });
      worker.postMessage({ kind: "init", directory });
    });
    return ready;
  }
  async function send(kind, operation) {
    await start();
    if (unavailable) throw unavailable;
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          Error(
            "Assistant request timed out. Reopen the conversation before retrying.",
          ),
        );
      }, 30_000);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ kind, id, operation });
    });
  }
  return {
    start,
    async request(operation) {
      if (closing) throw Error("Assistant is closing");
      if (
        !operation ||
        typeof operation !== "object" ||
        JSON.stringify(operation).length > 150_000
      )
        throw Error("Invalid assistant request");
      if (operation.type === "login_start" && !vault.available())
        throw Error(
          "Secure credential storage is unavailable. Unlock your system keychain.",
        );
      if (operation.type === "login_open_link") {
        const state = await send("request", { type: "login_status" });
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
          !["https:", "http:"].includes(url.protocol) ||
          (url.protocol === "http:" &&
            !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
        )
          throw Error("Unsupported sign-in link");
        await shell.openExternal(url.href);
        return null;
      }
      const result = await send("request", operation);
      return operation.type === "settings"
        ? { ...result, secureStorage: vault.available() }
        : result;
    },
    async close() {
      closing = true;
      if (!ready) return;
      try {
        await send("close");
      } finally {
        worker?.kill();
      }
    },
  };
}
module.exports = { createAssistantHost };
