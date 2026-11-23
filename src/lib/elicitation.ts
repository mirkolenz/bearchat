import type { ElicitationRequest, ElicitResult } from "@ai-sdk/mcp";

import { createStore } from "@/lib/store";

// Requests for user input that MCP servers send while handling a tool call, answered one at a time.
export interface InputRequest {
  id: string;
  server: string;
  message: string;
  requestedSchema: unknown;
  respond: (result: ElicitResult) => void;
}

const queue = createStore<readonly InputRequest[]>([]);

/** Asks the user for the input a server requested, resolving once they answered or the signal aborts. */
export function requestInput(
  server: string,
  { message, requestedSchema }: ElicitationRequest["params"],
  signal?: AbortSignal,
): Promise<ElicitResult> {
  return new Promise((resolve) => {
    const cancel = () => request.respond({ action: "cancel" });
    const request: InputRequest = {
      id: crypto.randomUUID(),
      server,
      message,
      requestedSchema,
      respond: (result) => {
        signal?.removeEventListener("abort", cancel);
        queue.set(queue.get().filter((entry) => entry !== request));
        resolve(result);
      },
    };
    queue.set([...queue.get(), request]);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

/** The request to show next, if any. */
export function useInputRequest(): InputRequest | undefined {
  return queue.useValue()[0];
}
