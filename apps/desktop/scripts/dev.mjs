import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";
import electron from "electron";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
});
await server.listen();
server.printUrls();
const env = {
  ...process.env,
  FIT_DESKTOP_DEV: "1",
  TODU_FIT_PROOF_DATA:
    process.env.TODU_FIT_PROOF_DATA ||
    path.resolve(root, "../../data/dev/desktop-profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [root], { cwd: root, env, stdio: "inherit" });
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null) child.kill();
  await server.close();
  process.exitCode = code;
}
child.on("error", (error) => {
  console.error(error);
  void stop(1);
});
child.on("exit", (code) => void stop(code ?? 0));
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
