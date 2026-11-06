const net = require("node:net");
const { randomUUID } = require("node:crypto");
const allowed = new Set([
  "setup_status",
  "setup_start",
  "identity_get",
  "groups_list",
  "group_create",
  "group_select",
  "group_join",
  "group_leave",
  "config_get",
  "dishes_list",
  "dish_get",
  "dish_create",
  "dish_update",
  "dish_delete",
  "plans_list",
  "plan_get",
  "plan_create",
  "plan_update",
  "plan_delete",
  "meal_save",
  "meals_history",
  "meal_delete",
  "shopping_list",
  "shopping_add",
  "shopping_edit",
  "shopping_remove",
  "shopping_set_checked",
  "shopping_clear_checked",
  "water_today",
  "water_history",
  "water_add",
  "water_delete",
  "water_settings_get",
  "water_settings_update",
  "status",
  "changes",
  "sync_start",
]);
function validate(operation) {
  if (
    !operation ||
    typeof operation !== "object" ||
    Array.isArray(operation) ||
    !allowed.has(operation.type)
  )
    throw new Error("Unsupported application operation");
  if (Buffer.byteLength(JSON.stringify(operation)) > 1024 * 1024)
    throw new Error("Request too large");
}
function openApplicationBridge(endpoint, timeoutMs = 15000) {
  let closed = false;
  const pending = new Set();
  function request(operation, id = randomUUID()) {
    validate(operation);
    if (closed) return Promise.reject(new Error("Client closed"));
    if (
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new Error("Invalid request ID");
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = net.createConnection(endpoint.trim());
      let buffer = Buffer.alloc(0);
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pending.delete(cancel);
        socket.destroy();
        if (error) reject(error);
        else resolve(value);
      };
      const cancel = () =>
        finish(
          new Error(
            "Connection closed; save outcome may be unknown. Reconnect and retry the same action.",
          ),
        );
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              "No response. Save outcome may be unknown. Retry the same action to recover its result.",
            ),
          ),
        timeoutMs,
      );
      pending.add(cancel);
      socket.on("error", () =>
        finish(
          new Error("Daemon unavailable. Reconnect and retry the same action."),
        ),
      );
      socket.on("connect", () =>
        socket.write(JSON.stringify({ version: 2, id, operation }) + "\n"),
      );
      socket.on("end", cancel);
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 8 * 1024 * 1024)
          return finish(new Error("Response too large"));
        const end = buffer.indexOf(10);
        if (end < 0) return;
        try {
          const r = JSON.parse(buffer.subarray(0, end));
          if (
            r.version !== 2 ||
            r.id !== id ||
            !Number.isSafeInteger(r.revision) ||
            !r.outcome
          )
            throw new Error("Invalid daemon response");
          if (r.outcome.status === "error")
            return finish(new Error(r.outcome.error.message), undefined);
          if (
            r.outcome.status !== "ok" ||
            typeof r.outcome.value?.type !== "string"
          )
            throw new Error("Invalid daemon result");
          finish(null, r.outcome.value);
        } catch (e) {
          finish(e);
        }
      });
    });
  }
  return {
    request,
    close: async () => {
      closed = true;
      for (const cancel of [...pending]) cancel();
    },
  };
}
module.exports = { openApplicationBridge, validate };
