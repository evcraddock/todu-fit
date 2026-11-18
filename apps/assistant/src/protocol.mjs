import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
export const PROTOCOL = 1;
export const MAX_FRAME = 8 * 1024 * 1024;
export async function readEndpoint(directory) {
  const endpoint = JSON.parse(
    await fs.readFile(path.join(directory, "worker.endpoint"), "utf8"),
  );
  if (
    endpoint.protocol !== PROTOCOL ||
    !Number.isInteger(endpoint.port) ||
    endpoint.port < 1 ||
    endpoint.port > 65535 ||
    !/^[0-9a-f]{64}$/.test(endpoint.token)
  )
    throw Error("Incompatible assistant endpoint");
  return endpoint;
}
export async function request(directory, operation, timeout = 30000) {
  const endpoint = await readEndpoint(directory);
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const socket = net.createConnection({
      host: "127.0.0.1",
      port: endpoint.port,
    });
    let buffer = Buffer.alloc(0),
      finished = false;
    const done = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(
      () =>
        done(
          Error(
            "Assistant request timed out; retry submissions with the same requestId.",
          ),
        ),
      timeout,
    );
    socket.once("connect", () =>
      socket.write(
        JSON.stringify({
          protocol: PROTOCOL,
          id,
          token: endpoint.token,
          operation,
        }) + "\n",
      ),
    );
    socket.on("error", () =>
      done(Error("Assistant is unavailable. Start the worker and retry.")),
    );
    socket.on("end", () =>
      done(Error("Assistant connection closed before responding.")),
    );
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_FRAME)
        return done(Error("Assistant response too large"));
      const end = buffer.indexOf(10);
      if (end < 0) return;
      try {
        const result = JSON.parse(buffer.subarray(0, end));
        if (result.id !== id || result.protocol !== PROTOCOL)
          throw Error("Invalid assistant response");
        if (result.error) throw Error(result.error);
        done(null, result.value);
      } catch (error) {
        done(error);
      }
    });
  });
}
