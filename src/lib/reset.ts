import { db } from "@/lib/db";
import { clearFiles } from "@/lib/files";

// Keys of localStorage and sessionStorage, such as the settings and the token, share this namespace.
const keyPrefix = "bearchat:";

/**
 * Deletes everything the app keeps in this browser and starts over.
 * It works on the storage itself, without the modules that read the config,
 * so it also works when the app failed to start.
 */
export async function resetApp(): Promise<void> {
  for (const storage of [localStorage, sessionStorage]) {
    for (const key of Object.keys(storage).filter((key) => key.startsWith(keyPrefix))) {
      storage.removeItem(key);
    }
  }

  // each store is cleared even if another one fails, such as a database that cannot be opened
  const results = await Promise.allSettled([
    db.delete(),
    clearFiles(),
    // ends the proxy's session in cookie mode, which is skipped when the config is unusable
    import("@/lib/connection").then(({ signOut }) => signOut()).catch(() => undefined),
  ]);
  const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);

  if (errors.length > 0) {
    throw new AggregateError(errors, "Some data could not be deleted");
  }

  // a fresh start, which also drops everything held in memory
  location.reload();
}
