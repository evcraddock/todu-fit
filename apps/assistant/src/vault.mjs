import fs from "node:fs/promises";
import path from "node:path";
import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { AsyncEntry } from "@napi-rs/keyring";
import { writeJson } from "./catalog.mjs";

// Only the worker reads the vault. The OS store holds a random encryption key,
// avoiding credential-size limits in Windows Credential Manager.
export function createVault(directory, suppliedEntry) {
  const file = path.join(directory, "credentials.v1.json");
  let entry;
  function getEntry() {
    return (entry ??=
      suppliedEntry ??
      new AsyncEntry(
        "todufit-assistant",
        createHash("sha256").update(directory).digest("hex"),
        { linux: { store: "secret-service" } },
      ));
  }
  async function key(create = false) {
    let value = await getEntry().getPassword();
    if (!value && create) {
      value = randomBytes(32).toString("base64");
      await getEntry().setPassword(value);
    }
    if (!value) return null;
    const bytes = Buffer.from(value, "base64");
    if (bytes.length !== 32) throw Error("Invalid vault key");
    return bytes;
  }
  async function read() {
    let value;
    try {
      value = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
    const secret = await key();
    if (!secret)
      throw Error(
        "Credential key is missing; unlock the system credential store.",
      );
    const cipher = createDecipheriv(
      "aes-256-gcm",
      secret,
      Buffer.from(value.iv, "base64"),
    );
    cipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return JSON.parse(
      Buffer.concat([
        cipher.update(Buffer.from(value.data, "base64")),
        cipher.final(),
      ]).toString(),
    );
  }
  return {
    async available() {
      try {
        await key();
        return true;
      } catch {
        return false;
      }
    },
    async exists() {
      try {
        await fs.access(file);
        return true;
      } catch (e) {
        if (e.code === "ENOENT") return false;
        throw e;
      }
    },
    async request(op) {
      try {
        if (op.type === "read") return await read();
        if (op.type !== "write") throw Error("Unknown vault operation");
        const secret = await key(true);
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", secret, iv);
        const data = Buffer.concat([
          cipher.update(JSON.stringify(op.value)),
          cipher.final(),
        ]);
        await writeJson(file, {
          version: 1,
          iv: iv.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
          data: data.toString("base64"),
        });
        return null;
      } catch {
        throw Error(
          "Unable to access secure credential storage. Unlock your system keychain.",
        );
      }
    },
  };
}
