const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs/promises");
async function stopWorker(directory) {
  const { request, readEndpoint } = await import(
    pathToFileURL(path.resolve(__dirname, "../../assistant/src/protocol.mjs"))
      .href
  );
  let endpoint;
  try {
    endpoint = await readEndpoint(directory);
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  try {
    await request(directory, { type: "worker_stop" });
  } catch {
    /* The isolated worker may already have exited. */
  }
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    try {
      process.kill(endpoint.pid, 0);
    } catch (e) {
      if (e.code === "ESRCH") return;
      throw e;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error(`Isolated assistant worker ${endpoint.pid} did not stop`);
}
module.exports = { stopWorker };
