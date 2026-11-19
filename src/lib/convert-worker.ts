// Converts documents to Markdown off the main thread, since anydoc blocks while it parses.
// Each request posts the bytes with a port, which receives the result.
import init, { formatFromBytes, toMarkdownBytes } from "@firecrawl/anydoc-wasm";

import { errorMessage, lazy } from "@/lib/utils";

export type DocumentResult = { markdown: string } | { unsupported: true } | { error: string };

const ready = lazy(() => init());

self.addEventListener("message", async ({ data, ports: [port] }: MessageEvent<Uint8Array>) => {
  let result: DocumentResult;

  try {
    await ready();
    const format = formatFromBytes(data);
    result =
      format === undefined ? { unsupported: true } : { markdown: toMarkdownBytes(data, format) };
  } catch (error) {
    result = { error: errorMessage(error) };
  }

  port.postMessage(result);
});
