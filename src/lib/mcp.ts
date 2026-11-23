import {
  type CompleteRequestParams,
  createMCPClient,
  ElicitationRequestSchema,
  type MCPClient,
} from "@ai-sdk/mcp";
import type { FileUIPart, TextUIPart, Tool, ToolSet } from "ai";
import { z } from "zod";

import { storeFile } from "@/lib/blobs";
import { convertFile } from "@/lib/convert";
import { requestInput } from "@/lib/elicitation";
import type { Settings } from "@/lib/settings";
import { mcpContentTool } from "@/lib/tools/content";

// One client per URL, shared by every name the URL is listed under, so renaming or duplicating a server reuses it.
// A failed connection is retried on the next use.
const clients = new Map<string, Promise<MCPClient>>();

interface ToolListing {
  tools: ToolSet;
  // names of the server's tools that declare no side effects
  readOnly: ReadonlySet<string>;
  // never without the server's ttlMs hint
  expires?: Temporal.Instant;
}

// Tool lists are cached for as long as the server's ttlMs hint allows, or for the client's lifetime without one.
const toolListings = new Map<string, Promise<ToolListing>>();
const ttlSchema = z.int().nonnegative();
// bounds connecting and listing, so that a server that never answers cannot stall every request
const requestOptions = { timeout: 10_000 };

// the key of the server's URL in the metadata of its tools, which their calls record
const urlKey = "bearchat/serverURL";

/** The URL of the server of an MCP tool or call, by its metadata, undefined for built-in tools. */
export function toolServer(metadata: Tool["metadata"]) {
  return metadata?.[urlKey];
}

async function connect(url: string): Promise<MCPClient> {
  const client = await createMCPClient({
    // a restarted server forgets its sessions, so the next use connects again
    transport: { type: "http", url, onSessionExpired: () => forget(url) },
    clientName: "BearChat",
    capabilities: { elicitation: {} },
    initializationOptions: requestOptions,
  });
  client.onElicitationRequest(ElicitationRequestSchema, (request) =>
    requestInput(new URL(url).host, request.params),
  );
  return client;
}

function client(url: string): Promise<MCPClient> {
  let pending = clients.get(url);

  if (pending === undefined) {
    pending = connect(url);
    pending.catch(() => clients.delete(url));
    clients.set(url, pending);
  }

  return pending;
}

/** Collects every page of a paginated list. */
async function allPages<T extends { nextCursor?: string }>(
  list: (cursor: string | undefined) => Promise<T>,
): Promise<T[]> {
  const pages = [await list(undefined)];

  while (pages.at(-1)?.nextCursor !== undefined) {
    pages.push(await list(pages.at(-1)?.nextCursor));
  }

  return pages;
}

async function listTools(url: string): Promise<ToolListing> {
  const mcp = await client(url);
  const pages = await allPages((cursor) =>
    mcp.listTools({ params: { cursor }, options: requestOptions }),
  );
  const definitions = { ...pages[0], tools: pages.flatMap((page) => page.tools) };
  const ttl = ttlSchema.safeParse(pages[0].ttlMs);
  return {
    tools: Object.fromEntries(
      Object.entries(mcp.toolsFromDefinitions(definitions)).map(([name, tool]) => [
        name,
        // the calls record the server's URL, which binds their approval to the server
        mcpContentTool({ ...tool, metadata: { ...tool.metadata, [urlKey]: url } }),
      ]),
    ),
    readOnly: new Set(
      definitions.tools
        .filter((definition) => definition.annotations?.readOnlyHint)
        .map((definition) => definition.name),
    ),
    expires: ttl.success ? Temporal.Now.instant().add({ milliseconds: ttl.data }) : undefined,
  };
}

/** The server's tools, listed again once expired, since a tool may have gained side effects meanwhile. */
async function toolListing(url: string): Promise<ToolListing> {
  const cached = toolListings.get(url);

  if (cached === undefined) {
    const pending = listTools(url);
    pending.catch(() => toolListings.get(url) === pending && toolListings.delete(url));
    toolListings.set(url, pending);
    return pending;
  }

  const listing = await cached;

  if (
    listing.expires === undefined ||
    Temporal.Instant.compare(Temporal.Now.instant(), listing.expires) < 0
  ) {
    return listing;
  }

  // concurrent callers share one refresh
  if (toolListings.get(url) === cached) {
    toolListings.delete(url);
  }

  return toolListing(url);
}

/** Closes the server's client and drops its tools, so that the next use connects again. */
function forget(url: string) {
  const pending = clients.get(url);
  clients.delete(url);
  toolListings.delete(url);
  // a client that failed to connect has nothing to close
  pending?.then((open) => open.close()).catch(() => undefined);
}

/** Closes the clients of servers that were removed, disabled or moved to another URL. */
function closeUnused(urls: ReadonlySet<string>) {
  for (const url of clients.keys()) {
    if (!urls.has(url)) {
      forget(url);
    }
  }
}

export interface McpServer {
  name: string;
  url: string;
}

export function enabledServers(settings: Settings): McpServer[] {
  return Object.entries(settings.mcpServers)
    .filter(([, server]) => server.enabled)
    .map(([name, server]) => ({ name, url: server.url }));
}

/** Called for each enabled server that cannot be reached, whose tools are then left out. */
export type ServerErrorHandler = (server: string, error: unknown) => void;

/**
 * Connects to the enabled servers and lists their tools as `name__tool`, with their instructions.
 * Built-in names never contain the separator and server names are unique,
 * so no tool can replace another one or inherit its approval.
 */
export async function serverTools(settings: Settings, onError: ServerErrorHandler) {
  const servers = enabledServers(settings);
  closeUnused(new Set(servers.map((server) => server.url)));
  const listed = await Promise.all(
    servers.map(async ({ name, url }) => {
      try {
        const [{ tools, readOnly }, { instructions }] = await Promise.all([
          toolListing(url),
          client(url),
        ]);
        return {
          instructions: instructions && `Instructions of the MCP server ${name}:\n${instructions}`,
          tools: Object.entries(tools).map(([tool, value]) => ({
            name: `${name}__${tool}`,
            value,
            approved: readOnly.has(tool),
          })),
        };
      } catch (error) {
        onError(name, error);
        return { instructions: undefined, tools: [] };
      }
    }),
  );
  return {
    tools: listed.flatMap((server) => server.tools),
    instructions: listed.flatMap((server) => server.instructions ?? []),
  };
}

type Capability = "prompts" | "resources" | "completions";

/** Runs a request on every server that declares the capability, skipping servers that fail. */
async function eachServer<T>(
  servers: McpServer[],
  capability: Capability,
  request: (mcp: MCPClient, server: McpServer) => Promise<T>,
): Promise<T[]> {
  const results = await Promise.allSettled(
    servers.map(async (server) => {
      const mcp = await client(server.url);
      return mcp.initializeResult.capabilities[capability] ? [await request(mcp, server)] : [];
    }),
  );
  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

export async function listPrompts(servers: McpServer[]) {
  const listed = await eachServer(servers, "prompts", async (mcp, server) =>
    (await allPages((cursor) => mcp.listPrompts({ params: { cursor }, options: requestOptions })))
      .flatMap((page) => page.prompts)
      .map((prompt) => ({ server, prompt })),
  );
  return listed.flat();
}

export async function listResources(servers: McpServer[]) {
  const listed = await eachServer(servers, "resources", async (mcp, server) => {
    const [pages, templates] = await Promise.all([
      allPages((cursor) => mcp.listResources({ params: { cursor }, options: requestOptions })),
      // only the first page, since the AI SDK's client takes no cursor for templates
      mcp
        .listResourceTemplates({ options: requestOptions })
        .catch(() => ({ resourceTemplates: [] })),
    ]);
    return {
      resources: pages.flatMap((page) => page.resources).map((resource) => ({ server, resource })),
      templates: templates.resourceTemplates.map((template) => ({ server, template })),
    };
  });
  return {
    resources: listed.flatMap((server) => server.resources),
    templates: listed.flatMap((server) => server.templates),
  };
}

export type CompletionRef = CompleteRequestParams["ref"];

/** Suggestions for an argument of a prompt or resource template, empty if the server offers none. */
export async function complete(
  server: McpServer,
  ref: CompletionRef,
  argument: string,
  value: string,
  context: Record<string, string>,
): Promise<string[]> {
  const [values = []] = await eachServer([server], "completions", async (mcp) => {
    const result = await mcp.complete({
      ref,
      argument: { name: argument, value },
      context: { arguments: context },
    });
    return result.completion.values;
  });
  return values;
}

type ResourceContents = Awaited<ReturnType<MCPClient["readResource"]>>["contents"][number];
type PromptMessage = Awaited<ReturnType<MCPClient["getPrompt"]>>["messages"][number];

/** Converts MCP content the same way as an attached file. */
async function convertedPart(content: BlobPart, name: string, type = ""): Promise<FileUIPart> {
  return storeFile(await convertFile(new File([content], name, { type })));
}

function resourcePart({ name, uri, mimeType, text, blob }: ResourceContents): Promise<FileUIPart> {
  if (typeof text === "string") {
    return convertedPart(text, name ?? uri, mimeType);
  }

  if (typeof blob === "string") {
    return convertedPart(Uint8Array.fromBase64(blob), name ?? uri, mimeType);
  }

  throw new Error(`${name ?? uri} has no content`);
}

export async function readResource(server: McpServer, uri: string): Promise<FileUIPart[]> {
  const result = await (await client(server.url)).readResource({ uri });
  return Promise.all(result.contents.map(resourcePart));
}

async function promptPart({ content }: PromptMessage): Promise<TextUIPart | FileUIPart> {
  switch (content.type) {
    case "text":
      return { type: "text", text: content.text };
    case "image":
      return convertedPart(Uint8Array.fromBase64(content.data), "image", content.mimeType);
    case "resource":
      return resourcePart(content.resource);
    case "resource_link":
      return { type: "text", text: content.uri };
  }
}

export type PromptMessages = { role: "user" | "assistant"; parts: (TextUIPart | FileUIPart)[] }[];

export async function getPrompt(
  server: McpServer,
  name: string,
  args: Record<string, string>,
): Promise<PromptMessages> {
  const result = await (await client(server.url)).getPrompt({ name, arguments: args });
  return Promise.all(
    result.messages.map(async (message) => ({
      role: message.role,
      parts: [await promptPart(message)],
    })),
  );
}
