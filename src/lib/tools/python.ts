import { tool, type ToolSet } from "ai";
import { z } from "zod";

import {
  appendFile,
  deleteFiles,
  fileExists,
  listNames,
  readFile,
  renameFile,
  writeFile,
} from "@/lib/files";
import { errorMessage, exclusive, lazy, namedError } from "@/lib/utils";

// Monty is loaded on first use, since its WebAssembly build is large.
const loadMonty = lazy(() => import("@pydantic/monty/wasm"));
// Runs of one chat take turns, so a few workers serve the rare parallel runs of different chats.
const montyPool = lazy(async () => (await loadMonty()).Monty.create({ maxProcesses: 2 }));

// The globals of each chat, dumped after every run, so that a chat holds a worker only while it runs.
const chatStates = new Map<string, Uint8Array>();

/** Discards the Python globals of a deleted chat. */
export function forgetPythonState(threadId: string) {
  chatStates.delete(threadId);
}

/** Prepares a file for open(), which Monty then reads with read_text and writes with append_text. */
async function openFile(path: string, mode: string): Promise<unknown> {
  const handle = new (await loadMonty()).MontyFileHandle(path, mode);

  if (handle.binary) {
    throw namedError("ValueError", "Binary files are not supported");
  }

  if (mode.startsWith("w")) {
    await writeFile(path, "");
  } else if (!(await fileExists(path))) {
    if (!mode.startsWith("a")) {
      throw namedError("FileNotFoundError", `No such file: ${path}`);
    }

    await writeFile(path, "");
  }

  return handle;
}

type FileCall = (path: string, args: unknown[]) => Promise<unknown>;

/** A call that writes the text argument and returns its length, as Python's write methods do. */
const textWriter =
  (write: (path: string, text: string) => Promise<void>): FileCall =>
  async (path, [, text]) => {
    const content = String(text);
    await write(path, content);
    return content.length;
  };

// Python reaches the browser files through open(), pathlib, os and imports, which Monty turns into these calls
// with absolute paths, where "/" is the flat directory holding all files.
const pythonFileCalls: ReadonlyMap<string, FileCall> = new Map<string, FileCall>([
  ["open", (path, [, mode]) => openFile(path, String(mode))],
  ["Path.read_text", (path) => readFile(path)],
  ["Path.write_text", textWriter(writeFile)],
  ["Path.append_text", textWriter(appendFile)],
  ["Path.exists", async (path) => path === "/" || (await fileExists(path))],
  ["Path.is_file", (path) => fileExists(path)],
  ["Path.is_dir", async (path) => path === "/"],
  ["Path.iterdir", async () => (await listNames()).map((name) => `/${name}`)],
  ["Path.unlink", (path) => deleteFiles([path])],
  [
    "Path.rename",
    async (path, [, target]) => {
      await renameFile(path, String(target));
      return target;
    },
  ],
]);

// Every file access suspends the sandbox for the host, which the duration limit does not count.
const limits = { maxMemory: 256_000_000, maxFeedDurationSecs: 30, maxSuspensions: 10_000 };
const maxOutputBytes = 100_000;

/** Runs code with the chat's globals, taking turns with the other runs of the chat so that none misses theirs. */
function runPython(
  threadId: string,
  fileCalls: ReadonlyMap<string, FileCall>,
  source: () => string | Promise<string>,
) {
  return exclusive(`python:${threadId}`, async () => {
    const { CollectString, MontyError, NOT_HANDLED } = await loadMonty();
    // Type checking is left off, since it cannot resolve the imports of the browser's Python files.
    const session = await (
      await montyPool()
    ).checkout({
      limits,
      // sleeping would only spend the time limit
      osPolicy: { timezone: Temporal.Now.timeZoneId(), sleep: "zero" },
    });
    const output = new CollectString(maxOutputBytes);

    try {
      const state = chatStates.get(threadId);

      if (state !== undefined) {
        await session.loadSession(state);
      }

      const result = await session.feedRun(await source(), {
        printCallback: output,
        os: (call, args) => {
          const handler = fileCalls.get(call);
          const target = String(args[0]);

          if (handler === undefined) {
            return NOT_HANDLED;
          }

          // there are no subdirectories, so imports move on from package paths such as /pkg/__init__.py
          if (target.lastIndexOf("/") > 0) {
            throw namedError("FileNotFoundError", `No such file: ${target}`);
          }

          return handler(target, args);
        },
      });
      return { result, output: output.output };
    } catch (error) {
      // Python errors show their traceback, while a crashed worker loses the globals of this run
      return {
        error: error instanceof MontyError ? error.display() : errorMessage(error),
        output: output.output,
      };
    } finally {
      // keeps the globals assigned before an exception, while a crashed worker keeps those of the last run
      await session.dump().then(
        (state) => chatStates.set(threadId, state),
        () => undefined,
      );
      await session.close();
    }
  });
}

// starts loading Monty while the model writes the input, a failure is reported by execute
const preload = () => void montyPool().catch(() => undefined);

export function createPythonTools(files: boolean, threadId: string): ToolSet {
  const fileCalls = files ? pythonFileCalls : new Map<string, FileCall>();

  const run_python = tool({
    description:
      "Run Python code in an isolated sandbox and return the value of the last expression and the printed output. " +
      "Variables, functions and imported modules persist across the runs of this chat. " +
      "It supports a subset of Python 3.14 with modules such as json, math, re, datetime, decimal, csv and base64, " +
      "but no third-party packages or network access, " +
      `and each run is limited to ${limits.maxFeedDurationSecs} seconds, ${limits.maxMemory / 1_000_000} MB of memory ` +
      `and ${maxOutputBytes / 1_000} kB of printed output. ` +
      (files
        ? "The browser's text files are available in a flat directory through open(), pathlib and os, " +
          "e.g. Path('notes.txt').read_text(), and Python files there can be imported as modules, " +
          "which run once per chat and are not reloaded after changes."
        : "It has no files."),
    inputSchema: z.object({ code: z.string().describe("Python source code to run") }),
    onInputStart: preload,
    execute: ({ code }) => runPython(threadId, fileCalls, () => code),
  });

  if (!files) {
    return { run_python };
  }

  return {
    run_python,
    run_python_file: tool({
      description:
        "Run a Python file from the browser's private file storage as the main script, " +
        "like run_python with the file's current content, so it shares this chat's variables. " +
        "Unlike an import, it runs the file again on every call.",
      inputSchema: z.object({
        name: z.string().describe("Python file name without directories, such as script.py"),
      }),
      onInputStart: preload,
      execute: ({ name }) => runPython(threadId, fileCalls, () => readFile(name)),
    }),
  };
}
