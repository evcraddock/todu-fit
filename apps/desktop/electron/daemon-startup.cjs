const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const path = require("node:path");
const { openApplicationBridge } = require("./application-bridge.cjs");
const exec = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function probe(endpoint) {
  const bridge = openApplicationBridge(endpoint, 700);
  try {
    await bridge.request({ type: "setup_status" });
    return true;
  } finally {
    await bridge.close();
  }
}

// The Rust owner lock arbitrates simultaneous launches. A losing child may exit;
// all clients still wait for the winner to become ready on the same endpoint.
async function connectOrStart({
  binary,
  config,
  endpoint,
  logPath,
  env = process.env,
  timeoutMs = 15000,
}) {
  if (endpoint) {
    await probe(endpoint);
    return endpoint;
  }
  const args = config ? ["-c", path.resolve(config)] : [];
  const { stdout } = await exec(
    binary,
    [...args, "config", "show", "--format", "json"],
    {
      env,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    },
  );
  const settings = JSON.parse(stdout);
  const dataDir = path.resolve(settings.data_dir.value);
  const endpointFile = path.join(dataDir, "daemon.endpoint");
  const readEndpoint = async () =>
    (await fs.readFile(endpointFile, "utf8")).trim();
  try {
    const existing = await readEndpoint();
    await probe(existing);
    return existing;
  } catch {
    /* No ready compatible owner; the daemon itself decides ownership. */
  }
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const log = await fs.open(logPath, "a", 0o600);
  let launchError;
  try {
    const child = spawn(binary, [...args, "daemon"], {
      env: { ...env, FIT_DATA_DIR: dataDir, FIT_DESKTOP_DAEMON: "1" },
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    child.on("error", (error) => {
      launchError = error;
    });
    child.unref();
  } finally {
    await log.close();
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (launchError)
      throw new Error(`Unable to start Fit daemon: ${launchError.message}`);
    try {
      const current = await readEndpoint();
      await probe(current);
      return current;
    } catch {
      /* Startup may still be acquiring its owner lock and binding IPC. */
    }
    await delay(100);
  }
  throw new Error(
    `Fit daemon did not become ready. Check configuration and permissions. Details: ${logPath}`,
  );
}
module.exports = { connectOrStart };
