import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { openAssistant } from "./runtime.mjs";
import { createVault } from "./vault.mjs";
import { migrate, finishMigration } from "./migrate.mjs";
import { writeJson } from "./catalog.mjs";
import { PROTOCOL, MAX_FRAME } from "./protocol.mjs";

export async function serve({
  directory,
  legacy,
  version = "development",
  vault: suppliedVault,
  openRuntime = openAssistant,
}) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  directory = await fs.realpath(directory);
  await fs.chmod(directory, 0o700);
  // An OS-backed SQLite exclusive lock arbitrates process ownership. It contains
  // no application data and is released by the kernel even after SIGKILL.
  const owner = new DatabaseSync(path.join(directory, "worker-lock.sqlite"));
  try {
    owner.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;");
  } catch {
    owner.close();
    throw Error("Assistant worker already owns this profile");
  }
  let runtime,
    opening,
    server,
    closing = false,
    published = false;
  const sockets = new Set();
  const endpointFile = path.join(directory, "worker.endpoint");
  const vault = suppliedVault ?? createVault(directory);
  const token = randomBytes(32).toString("hex");
  const markerFile = path.join(directory, "migration.json");
  const migrationState = async () => {
    try {
      return JSON.parse(await fs.readFile(markerFile, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  };
  const close = async () => {
    if (closing) return;
    closing = true;
    if (published) await fs.rm(endpointFile, { force: true });
    server?.close();
    for (const socket of sockets) socket.destroy();
    try {
      if (opening) await opening.catch(() => {});
      await runtime?.close();
    } finally {
      owner.close();
    }
  };
  try {
    await finishMigration(directory);
    await migrate(directory, legacy);
    const getRuntime = async () => {
      if ((await migrationState())?.credentialsPending)
        throw Error(
          "Open the desktop app once to migrate encrypted provider credentials.",
        );
      if (!opening)
        opening = openRuntime({ directory, vault: (op) => vault.request(op) })
          .then((value) => (runtime = value))
          .catch((error) => {
            opening = undefined;
            throw error;
          });
      return opening;
    };
    async function dispatch(op) {
      if (closing) throw Error("Assistant worker is stopping");
      if (!op || typeof op !== "object" || typeof op.type !== "string")
        throw Error("Invalid assistant operation");
      if (op.type === "worker_status")
        return {
          protocol: PROTOCOL,
          version,
          pid: process.pid,
          directory,
          credentialsPending: Boolean(
            (await migrationState())?.credentialsPending,
          ),
        };
      if (op.type === "worker_stop") {
        setTimeout(() => void close(), 50);
        return { stopping: true };
      }
      if (op.type === "credentials_import") {
        const marker = await migrationState();
        if (!marker?.credentialsPending)
          throw Error("No credential migration is pending");
        if (
          !op.credentials ||
          typeof op.credentials !== "object" ||
          Array.isArray(op.credentials)
        )
          throw Error("Invalid credential migration");
        for (const value of Object.values(op.credentials))
          if (!value || !["api_key", "oauth"].includes(value.type))
            throw Error("Invalid migrated credential");
        // A crash after vault persistence but before the marker update is safe to retry.
        if (!(await vault.exists()))
          await vault.request({ type: "write", value: op.credentials });
        await writeJson(markerFile, { ...marker, credentialsPending: false });
        await getRuntime();
        return { imported: true };
      }
      if (op.type === "login_start" && !(await vault.available()))
        throw Error(
          "Secure credential storage is unavailable. Unlock your system keychain.",
        );
      const value = await (await getRuntime()).request(op);
      return op.type === "settings"
        ? { ...value, secureStorage: await vault.available() }
        : value;
    }
    server = net.createServer((socket) => {
      if (closing || sockets.size >= 128) {
        socket.destroy();
        return;
      }
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      socket.setTimeout(35000, () => socket.destroy());
      let buffer = Buffer.alloc(0),
        admitted = false;
      socket.on("data", async (chunk) => {
        if (admitted) return;
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 180000) {
          socket.destroy();
          return;
        }
        const end = buffer.indexOf(10);
        if (end < 0) return;
        admitted = true;
        let frame;
        try {
          frame = JSON.parse(buffer.subarray(0, end));
          const supplied = Buffer.from(
            typeof frame.token === "string" ? frame.token : "",
          );
          if (
            supplied.length !== token.length ||
            !timingSafeEqual(supplied, Buffer.from(token))
          ) {
            socket.destroy();
            return;
          }
          if (
            frame.protocol !== PROTOCOL ||
            typeof frame.id !== "string" ||
            frame.id.length > 100
          )
            throw Error("Incompatible assistant protocol");
          const value = await dispatch(frame.operation);
          const result =
            JSON.stringify({ protocol: PROTOCOL, id: frame.id, value }) + "\n";
          if (Buffer.byteLength(result) > MAX_FRAME)
            throw Error("Assistant response too large; use pagination");
          socket.end(result);
        } catch (error) {
          // Never include the raw frame or credential-bearing arguments in logs/errors.
          socket.end(
            JSON.stringify({
              protocol: PROTOCOL,
              id: frame?.id,
              error: error.message,
            }) + "\n",
          );
        }
      });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    await writeJson(endpointFile, {
      protocol: PROTOCOL,
      token,
      port: server.address().port,
      pid: process.pid,
      version,
    });
    published = true;
    if (!(await migrationState())?.credentialsPending) await getRuntime();
    return { close, directory };
  } catch (error) {
    await close();
    throw error;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [directory, version, legacy] = process.argv.slice(2);
  if (!directory || !path.isAbsolute(directory))
    throw Error("Absolute assistant directory required");
  try {
    const service = await serve({ directory, version, legacy });
    process.once("SIGINT", () => void service.close());
    process.once("SIGTERM", () => void service.close());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
