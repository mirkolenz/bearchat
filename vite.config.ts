import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { z } from "zod";

import { backupSchema, configSchema } from "./src/lib/schemas.ts";
import { licenses } from "./vite.licenses.ts";

// Remote images stay blocked so that model output cannot exfiltrate data through image URLs.
// Directives that need headers, such as frame-ancestors, are set by the NixOS module.
const contentSecurityPolicy = {
  "default-src": ["'none'"],
  // WebAssembly runs the Python tool, which loads in a worker
  "script-src": ["'self'", "'wasm-unsafe-eval'"],
  "worker-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "blob:"],
  "font-src": ["'self'", "data:"],
  // data: lets text attachments be read back from their data URLs
  "connect-src": ["'self'", "data:", "https:", "http://localhost:*", "http://127.0.0.1:*"],
  "base-uri": ["'none'"],
  "form-action": ["'none'"],
  "object-src": ["'none'"],
} as const satisfies Record<string, readonly string[]>;

// The dev server relies on inline scripts.
function csp(): Plugin {
  const content = Object.entries(contentSecurityPolicy)
    .map(([directive, sources]) => [directive, ...sources].join(" "))
    .join("; ");

  return {
    name: "csp",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        injectTo: "head-prepend",
        attrs: { "http-equiv": "Content-Security-Policy", content },
      },
    ],
  };
}

// Publishes the formats of config.json and of exported chats, e.g. for editor validation via `$schema`.
function jsonSchemas(): Plugin {
  return {
    name: "json-schemas",
    apply: "build",
    generateBundle() {
      for (const [name, schema] of [
        ["config", configSchema],
        ["backup", backupSchema],
      ] as const) {
        this.emitFile({
          type: "asset",
          fileName: `${name}.schema.json`,
          source: JSON.stringify(z.toJSONSchema(schema, { io: "input" }), null, 2),
        });
      }
    },
  };
}

const proxyTarget = process.env.BEARCHAT_PROXY;

// Serves an inference server such as an SSH port forward on the same origin at `/v1`,
// with a config.json that points the app there.
function devProxy(target: string): Plugin {
  return {
    name: "dev-proxy",
    config: () => ({ server: { proxy: { "/v1/": { target, changeOrigin: true } } } }),
    configureServer(server) {
      server.middlewares.use("/config.json", (_, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ baseURL: "/v1" }));
      });
    },
  };
}

export default defineConfig({
  // relative asset paths let one build be served under any URL path
  base: "./",
  // Chats are routed by the query string, so unknown paths 404 like on a static file server
  // instead of falling back to the app, which in a new tab shows the sign-in.
  appType: "mpa",
  plugins: [
    react({ compiler: true }),
    tailwindcss(),
    csp(),
    jsonSchemas(),
    proxyTarget ? devProxy(proxyTarget) : null,
    licenses({
      fileName: "licenses.txt",
      packages: [
        "@bytecodealliance/preview2-shim",
        "@firecrawl/anydoc-wasm",
        "@fontsource-variable/inter",
        "tailwindcss",
        "tw-animate-css",
      ],
    }),
  ],
  build: { target: "esnext" },
  // Monty's worker imports its WebAssembly modules, which needs module workers
  worker: { format: "es" },
  resolve: { tsconfigPaths: true },
});
