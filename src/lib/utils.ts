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

/** Memoizes an asynchronous function by its argument, where a failure is retried on the next call. */
export function memoize<K, V>(init: (key: K) => Promise<V>): (key: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>();
  return (key) => {
    let pending = cache.get(key);

    if (pending === undefined) {
      pending = init(key).catch((error: unknown) => {
        cache.delete(key);
        throw error;
      });
      cache.set(key, pending);
    }

    return pending;
  };
}

/** Like Promise.allSettled over the mapped items, but with at most `limit` of them running at once. */
export async function settleConcurrently<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  const queue = items.entries();

  // each runner takes the next item until none are left
  const run = async () => {
    for (const [index, item] of queue) {
      [results[index]] = await Promise.allSettled([map(item)]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
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
