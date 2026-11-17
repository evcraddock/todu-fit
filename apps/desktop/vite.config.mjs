import { defineConfig } from "vite";
import { randomBytes } from "node:crypto";

export default defineConfig(({ command }) => {
  if (command !== "serve") return { base: "./" };

  const nonce = randomBytes(24).toString("base64");
  return {
    base: "./",
    html: { cspNonce: nonce },
    plugins: [
      {
        name: "desktop-development-csp",
        transformIndexHtml(html) {
          return html
            .replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`)
            .replace(
              "connect-src 'none'",
              "connect-src 'self' ws://127.0.0.1:5174",
            );
        },
      },
    ],
  };
});
