import { z } from "zod";

import { config } from "@/lib/config";
import { jsonSchema } from "@/lib/schemas";
import { errorMessage } from "@/lib/utils";

const connectionSchema = z.object({ baseURL: z.string(), apiKey: z.string().optional() });
// vLLM reports max_model_len and OpenRouter context_length, other servers neither
const modelsSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string(),
        max_model_len: z.number().optional(),
        context_length: z.number().optional(),
      })
      .transform((model) => ({
        id: model.id,
        contextLength: model.max_model_len ?? model.context_length,
      })),
  ),
});

export type Connection = z.infer<typeof connectionSchema>;
export type Model = z.infer<typeof modelsSchema>["data"][number];

export interface Session {
  connection: Connection;
  models: Model[];
}

// In token mode, the token lives in sessionStorage only and is bound to the server it was entered for.
const credentialsKey = "bearchat:credentials";
// The server URL is not secret and is remembered across sessions for convenience.
const baseURLKey = "bearchat:baseURL";
// Endpoints of the reverse proxy that manages the HttpOnly session cookie.
const loginPath = "auth/login";
const logoutPath = "auth/logout";

const storedConnectionSchema = jsonSchema.pipe(connectionSchema);

class UnauthorizedError extends Error {
  override message = "The server rejected the token";
}

/** Resolves a server URL relative to the page, since the AI SDK requires absolute URLs. */
function parseBaseURL(value: string): string {
  const url = new URL(value.trim(), document.baseURI);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The server URL must use http or https");
  }

  // the AI SDK appends endpoint paths to the URL as text, which would end up in these
  if (url.search !== "" || url.hash !== "") {
    throw new Error("The server URL cannot have a query or fragment");
  }

  // a directory URL, so that endpoints such as `models` resolve below it
  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }

  return url.href;
}

const fixedBaseURL = config.baseURL === undefined ? undefined : parseBaseURL(config.baseURL);

export function rememberedBaseURL(): string {
  return localStorage.getItem(baseURLKey) ?? "";
}

function storedConnection(): Connection | undefined {
  // in cookie mode, only the proxy can read the token
  const value = config.auth === "cookie" ? null : sessionStorage.getItem(credentialsKey);
  const credentials = value === null ? undefined : storedConnectionSchema.safeParse(value).data;

  if (fixedBaseURL === undefined) {
    return credentials;
  }

  // a fixed server is tried without a token since it may not require one
  return credentials?.baseURL === fixedBaseURL ? credentials : { baseURL: fixedBaseURL };
}

/** Whether signing out has an effect, since resuming falls back to a fixed server without a token. */
export function canSignOut(connection: Connection): boolean {
  // in cookie mode, signing out clears the proxy's cookie
  return config.auth === "cookie" || fixedBaseURL === undefined || connection.apiKey !== undefined;
}

async function openSession(connection: Connection): Promise<Session> {
  const response = await fetch(new URL("models", connection.baseURL), {
    headers: connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {},
    // bounded, so that a server that never answers cannot stall the startup
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 401 || response.status === 403) {
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    throw new Error(`Listing models failed with status ${response.status}`);
  }

  const available = modelsSchema.parse(await response.json()).data;
  const models = config.models
    ? config.models.flatMap((id) => available.filter((model) => model.id === id))
    : available.toSorted((a, b) => a.id.localeCompare(b.id));

  if (models.length === 0) {
    throw new Error("The server does not list any models");
  }

  // a lock must never be ignored, so a locked model that is not served blocks the session
  const locked = config.locked.model;

  if (locked !== undefined && !models.some((model) => model.id === locked)) {
    throw new Error(`The locked model ${locked} is not served`);
  }

  return { connection, models };
}

/** Resumes the stored session, without a session if the user has to sign in. */
export async function resumeSession(): Promise<{ session?: Session; error?: string }> {
  const connection = storedConnection();

  try {
    return connection ? { session: await openSession(connection) } : {};
  } catch (error) {
    return error instanceof UnauthorizedError ? {} : { error: errorMessage(error) };
  }
}

/** Validates the token against the server before keeping it. */
export async function signIn(serverURL: string, token: string): Promise<Session> {
  if (config.auth === "cookie" && fixedBaseURL !== undefined) {
    // The proxy validates the token before setting the cookie.
    // Its custom header forces a CORS preflight, which prevents cross-site login requests.
    const response = await fetch(loginPath, {
      method: "POST",
      headers: { "X-BearChat-Token": token },
    });

    if (response.status === 401) {
      throw new UnauthorizedError();
    }

    if (!response.ok) {
      throw new Error(`Sign-in failed with status ${response.status}`);
    }

    return openSession({ baseURL: fixedBaseURL });
  }

  const connection = {
    baseURL: fixedBaseURL ?? parseBaseURL(serverURL),
    apiKey: token || undefined,
  };
  const session = await openSession(connection);
  sessionStorage.setItem(credentialsKey, JSON.stringify(connection));

  if (fixedBaseURL === undefined) {
    localStorage.setItem(baseURLKey, connection.baseURL);
  }

  return session;
}

export async function signOut(): Promise<void> {
  sessionStorage.removeItem(credentialsKey);

  if (config.auth === "cookie") {
    const response = await fetch(logoutPath, { method: "POST" });

    if (!response.ok) {
      throw new Error(`Signing out failed with status ${response.status}`);
    }
  }
}
