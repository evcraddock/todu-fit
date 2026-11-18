const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

// One desktop instance owns this file. Only the main process sees safeStorage.
function credentialVault(directory, safeStorage) {
  const file = path.join(directory, "credentials.enc");
  const available = () =>
    safeStorage.isEncryptionAvailable() &&
    safeStorage.getSelectedStorageBackend?.() !== "basic_text";
  async function read() {
    try {
      const bytes = await fs.readFile(file);
      if (!available())
        throw Error(
          "Secure credential storage is unavailable. Unlock your system keychain.",
        );
      return JSON.parse(safeStorage.decryptString(bytes));
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  }
  return {
    available,
    async request(operation) {
      if (operation.type === "read") return read();
      if (operation.type !== "write")
        throw Error("Unknown credential operation");
      if (!available())
        throw Error(
          "Secure credential storage is unavailable. Unlock your system keychain.",
        );
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${file}.${crypto.randomUUID()}.tmp`;
      const handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(
          safeStorage.encryptString(JSON.stringify(operation.value)),
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await fs.rename(temporary, file);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      return null;
    },
  };
}
module.exports = { credentialVault };
