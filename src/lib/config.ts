import { z } from "zod";

import { configSchema } from "@/lib/schemas";

type Config = z.infer<typeof configSchema>;

/** Loads the optional config.json next to index.html, see the README for its options. */
async function loadConfig(): Promise<Config> {
  // Accepting only JSON keeps the dev server from answering with index.html.
  const response = await fetch("config.json", {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to load config.json: ${response.status}`);
  }

  const result = configSchema.safeParse(response.ok ? await response.json() : {});

  if (!result.success) {
    throw new Error(`Invalid config.json: ${z.prettifyError(result.error)}`);
  }

  return result.data;
}

export const config = await loadConfig();
