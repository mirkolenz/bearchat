import { readFileSync } from "node:fs";

import { initWasm, Resvg } from "@resvg/resvg-wasm";
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
  "manifest-src": ["'self'"],
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

// Makes the app installable, with icons that put the favicon on an opaque background,
// scaled into the maskable safe zone, a circle with 40% of the size as radius,
// which the tail tip 18 units from (15.5, 17.5) touches.
function webApp(): Plugin {
  const background = "#d9f0e8";
  const favicon = readFileSync(new URL("src/favicon.svg", import.meta.url), "utf8");
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${background}"/><g transform="translate(16 16) scale(.71) translate(-15.5 -17.5)">${favicon}</g></svg>`;
  // Safari scales the largest icon down for the home screen and the macOS dock
  const largest = 1024;
  const sizes = [192, 512, largest];
  // .json instead of .webmanifest, which static file servers may not know the type of
  const manifest = {
    name: "BearChat",
    description: "Private browser-only chat interface for OpenAI-compatible inference servers",
    start_url: "./",
    display: "standalone",
    background_color: background,
    icons: sizes.flatMap((size) =>
      ["any", "maskable"].map((purpose) => ({
        src: `icon-${size}.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose,
      })),
    ),
  };
  // the WebAssembly module can only be initialized once per process
  let initialized: Promise<void> | undefined;

  return {
    name: "web-app",
    apply: "build",
    async generateBundle() {
      initialized ??= initWasm(
        readFileSync(new URL(import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"))),
      );
      await initialized;
      const emit = (fileName: string, source: string | Uint8Array) =>
        this.emitFile({ type: "asset", fileName, source });
      const png = (size: number) =>
        new Resvg(icon, { fitTo: { mode: "width", value: size } }).render().asPng();

      for (const size of sizes) {
        emit(`icon-${size}.png`, png(size));
      }

      emit("manifest.json", JSON.stringify(manifest, null, 2));
    },
    transformIndexHtml: () => [
      { tag: "link", injectTo: "head", attrs: { rel: "manifest", href: "manifest.json" } },
      {
        tag: "link",
        injectTo: "head",
        attrs: { rel: "apple-touch-icon", href: `icon-${largest}.png` },
      },
    ],
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
    webApp(),
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
