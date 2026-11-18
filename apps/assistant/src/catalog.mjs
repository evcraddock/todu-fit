import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function writeJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

// Pi owns fetching and interpreting catalogs; this adapter only persists its cache.
export async function modelCatalog(directory) {
  const root = path.join(directory, "models");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const file = (id) =>
    path.join(root, `${Buffer.from(id).toString("hex")}.json`);
  return {
    async read(id, options) {
      options?.signal?.throwIfAborted();
      try {
        return JSON.parse(await fs.readFile(file(id), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }
    },
    async write(id, entry, options) {
      options?.signal?.throwIfAborted();
      await writeJson(file(id), entry);
    },
    async delete(id, options) {
      options?.signal?.throwIfAborted();
      await fs.rm(file(id), { force: true });
    },
  };
}
