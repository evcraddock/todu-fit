// Local-only transport for Swift/Rust document compatibility fixtures.
// Usage: node integration-tests/ios-fixture-host.cjs /absolute/temporary/directory
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const directory = process.argv[2];
if (!directory || !path.isAbsolute(directory))
  throw Error("Supply an absolute fixture directory");
fs.mkdirSync(directory, { recursive: true });
http
  .createServer((request, response) => {
    if (!/^\/[a-z-]+(?:\.core)?\.automerge$/.test(request.url)) {
      response.writeHead(400).end();
      return;
    }
    const file = path.join(directory, request.url.slice(1));
    if (request.method === "PUT") {
      const chunks = [];
      let size = 0;
      request.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          response.writeHead(413).end();
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => {
        fs.writeFileSync(file, Buffer.concat(chunks));
        response.end("ok");
      });
    } else if (request.method === "GET") {
      try {
        response.end(fs.readFileSync(file));
      } catch {
        response.writeHead(404).end();
      }
    } else response.writeHead(405).end();
  })
  .listen(18767, "127.0.0.1", () =>
    console.log(`Local iOS fixtures: ${directory}`),
  );
