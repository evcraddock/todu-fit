import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.resolve(
  process.argv[2] || path.join(root, "../desktop/assistant-worker"),
);
const nodeVersion = "24.22.1";
const platform = process.platform,
  arch = process.arch;
if (
  !["darwin", "linux", "win32"].includes(platform) ||
  !["arm64", "x64"].includes(arch)
)
  throw Error("Unsupported worker platform");
const distribution = `node-v${nodeVersion}-${platform === "win32" ? "win" : platform}-${arch}`;
const archive = distribution + (platform === "win32" ? ".zip" : ".tar.gz");
const base = `https://nodejs.org/dist/v${nodeVersion}/`;
async function download(name) {
  const response = await fetch(base + name);
  if (!response.ok)
    throw Error(`Cannot download Node runtime: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const cache = path.join(root, ".runtime-cache");
await fs.mkdir(cache, { recursive: true });
const archivePath = path.join(cache, archive);
const sums = (await download("SHASUMS256.txt")).toString();
const expected = sums
  .split("\n")
  .find((line) => line.endsWith("  " + archive))
  ?.split(" ")[0];
if (!expected) throw Error("Node runtime checksum missing");
let bytes;
try {
  bytes = await fs.readFile(archivePath);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
if (!bytes || createHash("sha256").update(bytes).digest("hex") !== expected) {
  bytes = await download(archive);
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
    throw Error("Node runtime checksum mismatch");
  await fs.writeFile(archivePath, bytes);
}
const extraction = path.join(cache, distribution);
const binaryMember = platform === "win32" ? "node.exe" : "bin/node";
try {
  await fs.access(path.join(extraction, binaryMember));
  await fs.access(path.join(extraction, "LICENSE"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  // Windows ships bsdtar, which can also read the Node distribution's ZIP.
  execFileSync(platform === "win32" ? "tar.exe" : "tar", [
    "-xf",
    archivePath,
    "-C",
    cache,
    distribution + "/" + binaryMember,
    distribution + "/LICENSE",
  ]);
}
const staging = output + "." + randomUUID();
await fs.mkdir(staging, { recursive: true });
try {
  await fs.cp(path.join(root, "src"), path.join(staging, "src"), {
    recursive: true,
  });
  for (const name of ["package.json", "package-lock.json"])
    await fs.copyFile(path.join(root, name), path.join(staging, name));
  execFileSync(
    platform === "win32" ? "npm.cmd" : "npm",
    ["ci", "--omit=dev", "--ignore-scripts"],
    { cwd: staging, stdio: "inherit", shell: platform === "win32" },
  );
  await fs.copyFile(
    path.join(extraction, binaryMember),
    path.join(staging, platform === "win32" ? "node.exe" : "node"),
  );
  await fs.copyFile(
    path.join(extraction, "LICENSE"),
    path.join(staging, "NODE-LICENSE"),
  );
  if (platform !== "win32") await fs.chmod(path.join(staging, "node"), 0o755);
  const digest = createHash("sha256").update(
    `${nodeVersion}:${platform}:${arch}`,
  );
  for (const name of (await fs.readdir(path.join(staging, "src"))).sort())
    digest
      .update(name)
      .update(await fs.readFile(path.join(staging, "src", name)));
  digest.update(await fs.readFile(path.join(staging, "package-lock.json")));
  await fs.writeFile(
    path.join(staging, "bundle.json"),
    JSON.stringify({
      version: digest.digest("hex"),
      nodeVersion,
      platform,
      arch,
    }),
  );
  await fs.rm(output, { recursive: true, force: true });
  await fs.rename(staging, output);
} finally {
  await fs.rm(staging, { recursive: true, force: true });
}
console.log(`Built assistant worker: ${output}`);
