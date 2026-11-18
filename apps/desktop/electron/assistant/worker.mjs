import { openAssistant } from "./runtime.mjs";
const channel = process.parentPort;
const send = (value) =>
  channel ? channel.postMessage(value) : process.send(value);
const listen = (fn) =>
  channel
    ? channel.on("message", (event) => fn(event.data))
    : process.on("message", fn);
let sequence = 0;
const pending = new Map();
let runtime;
let initialization;
listen(async (message) => {
  if (message.kind === "vault_result") {
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (waiter)
      message.error
        ? waiter.reject(Error(message.error))
        : waiter.resolve(message.value);
    return;
  }
  try {
    if (message.kind === "init") {
      initialization = openAssistant({
        directory: message.directory,
        vault: (operation) =>
          new Promise((resolve, reject) => {
            const id = ++sequence;
            pending.set(id, { resolve, reject });
            send({ kind: "vault", id, operation });
          }),
      });
      runtime = await initialization;
      send({ kind: "ready" });
      return;
    }
    await initialization;
    if (!runtime) throw Error("Assistant has not started");
    if (message.kind === "close") {
      await runtime.close();
      send({ kind: "result", id: message.id, value: null });
      process.exit(0);
    } else if (message.kind === "request") {
      const value = await runtime.request(message.operation);
      send({ kind: "result", id: message.id, value });
    }
  } catch (error) {
    send({
      kind: message.kind === "init" ? "failed" : "result",
      id: message.id,
      error: error.message,
    });
  }
});
