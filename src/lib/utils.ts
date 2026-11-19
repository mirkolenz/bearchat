import { z } from "zod";

export { cn } from "cn";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const compactNumber = new Intl.NumberFormat(undefined, { notation: "compact" });
/** The current time in milliseconds since the Unix epoch, the form timestamps are stored in. */
export function now(): number {
  return Temporal.Now.instant().epochMilliseconds;
}

/** Formats a stored timestamp in the user's language and time zone. */
export function formatTime(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** The seconds between two stored timestamps. */
export function secondsBetween(start: number, end: number): number {
  return Temporal.Instant.fromEpochMilliseconds(end)
    .since(Temporal.Instant.fromEpochMilliseconds(start))
    .total("seconds");
}

/** Runs the task while holding the named lock, which is shared by all tabs of the app. */
export function exclusive<T>(name: string, task: () => Promise<T>): Promise<T> {
  return navigator.locks.request(`bearchat:${name}`, task);
}

/** Memoizes an asynchronous initialization, which is retried on the next call after a failure. */
export function lazy<T>(init: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | undefined;
  return () =>
    (promise ??= init().catch((error: unknown) => {
      promise = undefined;
      throw error;
    }));
}

/** Decodes UTF-8 text, or returns undefined for binary data, which models cannot read as text. */
export function decodeText(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

export function downloadFile(name: string, content: BlobPart, type?: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Parses a JSON string, so that it can be piped into a schema of the expected shape. */
export const jsonSchema = z.string().transform((text, context): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    context.addIssue({ code: "custom", message: "Invalid JSON" });
    return z.NEVER;
  }
});
