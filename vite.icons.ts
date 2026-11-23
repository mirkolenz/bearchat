// A worker that renders an SVG as PNGs. Each build starts one, since the WebAssembly renderer
// can only be initialized once per module instance, which Node shares across the config loads of a process.
import { readFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";

import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { z } from "zod";

const requestSchema = z.object({ svg: z.string(), widths: z.array(z.int().positive()) });
export type IconRequest = z.input<typeof requestSchema>;

const { svg, widths } = requestSchema.parse(workerData);
await initWasm(readFileSync(new URL(import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"))));
parentPort?.postMessage(
  widths.map((width) =>
    new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng(),
  ),
);
