const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createExternalLinkHandler } = require("../electron/external-links.cjs");
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("web links open externally while Electron popup creation is denied", async () => {
  const opened = [];
  const handler = createExternalLinkHandler(
    (url) => opened.push(url),
    assert.fail,
  );
  for (const url of [
    "https://example.com/recipe?a=1#steps",
    "http://example.com/",
  ]) {
    assert.deepEqual(handler({ url }), { action: "deny" });
  }
  await flush();
  assert.deepEqual(opened, [
    "https://example.com/recipe?a=1#steps",
    "http://example.com/",
  ]);
});

test("invalid URLs, local files, scripts and custom protocols never reach the OS", async () => {
  const handler = createExternalLinkHandler(assert.fail, assert.fail);
  for (const url of [
    "not a URL",
    "file:///tmp/test",
    "javascript:alert(1)",
    "data:text/html,test",
    "mailto:test@example.com",
    "custom://command",
  ]) {
    assert.deepEqual(handler({ url }), { action: "deny" });
  }
  await flush();
});

test("browser launch errors are reported", async () => {
  const error = new Error("No browser available");
  const errors = [];
  const handler = createExternalLinkHandler(
    async () => {
      throw error;
    },
    (value) => errors.push(value),
  );
  handler({ url: "https://example.com/" });
  await flush();
  assert.deepEqual(errors, [error]);
});
