import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { deleteFile, fileExists, listNames, readFile, renameFile, writeFile } from "@/lib/files";
import { serverTools } from "@/lib/mcp";
import type { Settings } from "@/lib/settings";
import { errorMessage } from "@/lib/utils";

// Monty is loaded on first use, since its WebAssembly build is large.
let monty: Promise<typeof import("@pydantic/monty/wasm")> | undefined;
let montyPool: ReturnType<typeof import("@pydantic/monty/wasm").Monty.create> | undefined;

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

function createPythonTool(files: boolean) {
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
      execute: async ({ code }) => {
        monty ??= import("@pydantic/monty/wasm");
        const { CollectString, Monty, NOT_HANDLED } = await monty;
        montyPool ??= Monty.create();
        const session = await (
          await montyPool
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

const nameSchema = z.object({ name: z.string().describe("File name without directories") });

const fileTools = {
  list_files: tool({
    description: "List the files in the browser's private file storage.",
    inputSchema: z.object({}),
    execute: () => listNames(),
  }),
  read_file: tool({
    description: "Read a text file from the browser's private file storage.",
    inputSchema: nameSchema,
    execute: async ({ name }) => readFile(name),
  }),
  write_file: tool({
    description: "Create or overwrite a text file in the browser's private file storage.",
    inputSchema: nameSchema.extend({ content: z.string() }),
    execute: async ({ name, content }) => {
      await writeFile(name, content);
      return "written";
    },
  }),
  delete_file: tool({
    description: "Delete a file from the browser's private file storage.",
    inputSchema: nameSchema,
    execute: async ({ name }) => {
      await deleteFile(name);
      return "deleted";
    },
  }),
};

/** Collects the enabled tools, the names of those that run without approval, and the servers' instructions. */
export async function createTools(settings: Settings) {
  // Built-in tools only touch the app's own browser storage, so they always run.
  const builtIn: ToolSet = {
    ...(settings.fileTools ? fileTools : {}),
    ...(settings.pythonTool ? createPythonTool(settings.fileTools) : {}),
  };
  const servers = await serverTools(settings);
  return {
    tools: Object.assign(
      {},
      builtIn,
      Object.fromEntries(servers.tools.map((tool) => [tool.name, tool.value])),
    ),
    approved: new Set([
      ...Object.keys(builtIn),
      ...servers.tools.filter((tool) => tool.approved).map((tool) => tool.name),
    ]),
    instructions: servers.instructions,
  };
}
