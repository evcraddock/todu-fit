import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAppearance,
  readAppearance,
  saveAppearance,
} from "../src/theme.ts";

test("appearance follows system changes only in System mode and removes listeners", () => {
  const listeners = new Set();
  const media = {
    matches: false,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  };
  globalThis.window = { matchMedia: () => media };
  globalThis.document = { documentElement: { dataset: {} } };
  const theme = () => document.documentElement.dataset.theme;
  const change = (dark) => {
    media.matches = dark;
    listeners.forEach((fn) => fn());
  };
  let cleanup = applyAppearance("system");
  assert.equal(theme(), "light");
  change(true);
  assert.equal(theme(), "dark");
  cleanup();
  assert.equal(listeners.size, 0);
  for (const explicit of ["light", "dark"]) {
    cleanup = applyAppearance(explicit);
    change(false);
    assert.equal(theme(), explicit);
    change(true);
    assert.equal(theme(), explicit);
    cleanup();
  }
  delete globalThis.window;
  delete globalThis.document;
});

test("appearance persists and defaults safely for missing, invalid or unavailable storage", () => {
  let value = null;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => value,
      setItem: (_, next) => {
        value = next;
      },
    },
  });
  assert.equal(readAppearance(), "system");
  for (const choice of ["dark", "light", "system"]) {
    saveAppearance(choice);
    assert.equal(readAppearance(), choice);
  }
  value = "invalid";
  assert.equal(readAppearance(), "system");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("Unavailable");
    },
  });
  assert.equal(readAppearance(), "system");
  assert.doesNotThrow(() => saveAppearance("dark"));
  delete globalThis.localStorage;
});
