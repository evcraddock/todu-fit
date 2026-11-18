import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { request } from "./protocol.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
export async function ensureWorker({
  directory,
  bundle = path.resolve(here, ".."),
  legacy,
  timeout = 25000,
}) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  directory = await fs.realpath(directory);
  let manifest;
  try {
    manifest = JSON.parse(
      await fs.readFile(path.join(bundle, "bundle.json"), "utf8"),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    manifest = { version: "development" };
  }
  const probe = async () => {
    const status = await request(directory, { type: "worker_status" }, 1000);
    if (status.version !== manifest.version)
      throw Object.assign(
        Error(
          "Assistant update is ready. Run fit ai worker stop, then retry; unfinished tasks will resume.",
        ),
        { code: "VERSION_MISMATCH" },
      );
    return status;
  };
  try {
    return await probe();
  } catch (e) {
    if (e.code === "VERSION_MISMATCH") throw e;
  }
  let runtime = bundle;
  if (manifest.version !== "development") {
    if (!/^[0-9a-f]{64}$/.test(manifest.version))
      throw Error("Invalid worker bundle version");
    const root = path.join(directory, "runtimes");
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    runtime = path.join(root, manifest.version);
    try {
      await fs.access(path.join(runtime, "bundle.json"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      const temporary = path.join(root, randomUUID());
      try {
        await fs.cp(bundle, temporary, { recursive: true });
        try {
          await fs.rename(temporary, runtime);
        } catch (rename) {
          if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(rename.code))
            throw rename;
          await fs.access(path.join(runtime, "bundle.json"));
        }
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
    }
  }
  const binary =
    manifest.version === "development"
      ? process.execPath
      : path.join(runtime, process.platform === "win32" ? "node.exe" : "node");
  const log = await fs.open(path.join(directory, "worker.log"), "a", 0o600);
  let launchError;
  try {
    const child = spawn(
      binary,
      [
        path.join(runtime, "src/server.mjs"),
        directory,
        manifest.version,
        ...(legacy ? [path.resolve(legacy)] : []),
      ],
      {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", log.fd, log.fd],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      },
    );
    child.once("error", (error) => (launchError = error));
    child.unref();
  } finally {
    await log.close();
  }
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (launchError) throw Error("Unable to start assistant runtime");
    try {
      return await probe();
    } catch (e) {
      if (e.code === "VERSION_MISMATCH") throw e;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(
    `Assistant did not become ready. Check ${path.join(directory, "worker.log")}`,
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [directory, legacy] = process.argv.slice(2);
  try {
    console.log(JSON.stringify(await ensureWorker({ directory, legacy })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
