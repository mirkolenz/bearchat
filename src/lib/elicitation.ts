import type { ElicitationRequest, ElicitResult } from "@ai-sdk/mcp";
import { useSyncExternalStore } from "react";

// Requests for user input that MCP servers send while handling a tool call, answered one at a time.
export interface InputRequest {
  id: string;
  server: string;
  message: string;
  requestedSchema: unknown;
  respond: (result: ElicitResult) => void;
}

let queue: readonly InputRequest[] = [];
const listeners = new Set<() => void>();

function update(next: readonly InputRequest[]) {
  queue = next;
  listeners.forEach((listener) => listener());
}

/** Asks the user for the input a server requested, resolving once they answered. */
export function requestInput(
  server: string,
  { message, requestedSchema }: ElicitationRequest["params"],
): Promise<ElicitResult> {
  return new Promise((resolve) => {
    const request: InputRequest = {
      id: crypto.randomUUID(),
      server,
      message,
      requestedSchema,
      respond: (result) => {
        update(queue.filter((entry) => entry !== request));
        resolve(result);
      },
    };
    update([...queue, request]);
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The request to show next, if any. */
export function useInputRequest(): InputRequest | undefined {
  return useSyncExternalStore(subscribe, () => queue[0]);
}
