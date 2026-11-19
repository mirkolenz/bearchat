import { tool } from "ai";
import { z } from "zod";

import { deleteFile, fileExists, listNames, readFile, renameFile, writeFile } from "@/lib/files";
import { errorMessage, lazy } from "@/lib/utils";

// Monty is loaded on first use, since its WebAssembly build is large.
const loadMonty = lazy(() => import("@pydantic/monty/wasm"));
const montyPool = lazy(async () => (await loadMonty()).Monty.create());

// Python reaches the browser files through pathlib and os, which Monty turns into these calls
// with absolute paths, where "/" is the flat directory holding all files.
const pythonFileCalls = new Map<string, (path: string, args: unknown[]) => Promise<unknown>>([
  ["Path.read_text", (path) => readFile(path)],
  [
    "Path.write_text",
    async (path, [, text]) => {
      await writeFile(path, String(text));
      return String(text).length;
    },
  ],
  ["Path.exists", async (path) => path === "/" || (await fileExists(path))],
  ["Path.is_file", (path) => fileExists(path)],
  ["Path.is_dir", async (path) => path === "/"],
  ["Path.iterdir", async () => (await listNames()).map((name) => `/${name}`)],
  ["Path.unlink", (path) => deleteFile(path)],
  [
    "Path.rename",
    async (path, [, target]) => {
      await renameFile(path, String(target));
      return target;
    },
  ],
]);

export function createPythonTool(files: boolean) {
  return {
    run_python: tool({
      description:
        "Run Python in an isolated sandbox and return the value of the last expression and the printed output. " +
        "It supports a subset of Python 3.14 with modules such as json, math, re, datetime, decimal, csv and base64, " +
        "but no third-party packages or network access. " +
        (files
          ? "The browser's text files are available through pathlib and os in a flat directory, " +
            "e.g. Path('notes.txt').read_text() or write_text(), but open() is not supported."
          : "It has no files."),
      inputSchema: z.object({ code: z.string() }),
      // starts loading Monty while the model writes the code, a failure is reported by execute
      onInputStart: () => void montyPool().catch(() => undefined),
      execute: async ({ code }) => {
        const { CollectString, NOT_HANDLED } = await loadMonty();
        const session = await (
          await montyPool()
        ).checkout({
          limits: { maxMemory: 256_000_000, maxFeedDurationSecs: 30 },
        });
        const output = new CollectString();

        try {
          const result = await session.feedRun(code, {
            printCallback: output,
            os: (call, args) => {
              const handler = files ? pythonFileCalls.get(call) : undefined;
              return handler ? handler(String(args[0]), args) : NOT_HANDLED;
            },
          });
          return { result, output: output.output };
        } catch (error) {
          return { error: errorMessage(error), output: output.output };
        } finally {
          await session.close();
        }
      },
    }),
  };
}
