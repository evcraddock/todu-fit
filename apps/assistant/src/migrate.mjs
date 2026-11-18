import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { writeJson } from "./catalog.mjs";
export async function migrate(directory, legacy) {
  if (!legacy || path.resolve(legacy) === directory) return;
  const marker = path.join(directory, "migration.json");
  try {
    await fs.access(marker);
    return;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  try {
    await fs.access(path.join(legacy, "installation.json"));
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  const existing = await fs.readdir(directory);
  if (
    existing.some((name) =>
      ["installation.json", "settings.json", "conversations.sqlite"].includes(
        name,
      ),
    )
  )
    throw Error(
      "Assistant stores both contain data. Choose a shared profile before migration.",
    );
  const staging = path.join(directory, "migration-staging");
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { mode: 0o700 });
  for (const name of ["installation.json", "settings.json", "models"]) {
    try {
      await fs.cp(path.join(legacy, name), path.join(staging, name), {
        recursive: true,
      });
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  try {
    const source = new DatabaseSync(path.join(legacy, "conversations.sqlite"), {
      readOnly: true,
    });
    try {
      await backup(source, path.join(staging, "conversations.sqlite"));
    } finally {
      source.close();
    }
  } catch (e) {
    if (e.code !== "ERR_SQLITE_ERROR") throw e;
    throw Error("Cannot back up legacy conversations");
  }
  let credentialsPending = false;
  try {
    await fs.access(path.join(legacy, "credentials.enc"));
    credentialsPending = true;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  // Staged copy is complete before publishing any source files. Keep legacy intact.
  await writeJson(marker, {
    source: path.resolve(legacy),
    credentialsPending,
    staged: true,
  });
  await finishMigration(directory);
}
export async function finishMigration(directory) {
  const file = path.join(directory, "migration.json");
  let marker;
  try {
    marker = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  if (!marker.staged) return;
  const staging = path.join(directory, "migration-staging");
  for (const name of await fs.readdir(staging))
    await fs.rename(path.join(staging, name), path.join(directory, name));
  await writeJson(file, { ...marker, staged: false });
  await fs.rmdir(staging);
}
