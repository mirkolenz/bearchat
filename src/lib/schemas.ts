// Formats that are persisted or read from outside, kept free of other imports so the build can publish them as JSON Schema.
import { z } from "zod";

const timestamp = z.int().nonnegative().describe("Milliseconds since the Unix epoch");
const tokens = z.int().nonnegative();

export const reasoningLevels = [
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
// The name prefixes the server's tools as `name__tool`, so it cannot contain the separator.
export const mcpServerNameSchema = z
  .string()
  .regex(/^[a-zA-Z0-9-]{1,16}$/, "Use up to 16 letters, digits or hyphens");
export const mcpServerURLSchema = z.url({ protocol: /^https?$/ });
// how MCP tools with side effects are handled, built-in and read-only tools always run
export const executionModes = ["allow", "ask", "deny"] as const;

/** Settings shared by the deployment, user and chat layers, see settings.ts for how they are resolved. */
export const settingsSchema = z.object({
  model: z.string(),
  reasoning: z.enum(reasoningLevels),
  mode: z.enum(executionModes),
  instructions: z.string(),
  // merged into every request body, e.g. sampling parameters of the server
  requestBody: z.record(z.string(), z.json()),
  pythonTool: z.boolean(),
  fileTools: z.boolean(),
  chatTools: z.boolean(),
  mcpServers: z.record(
    mcpServerNameSchema,
    z.object({ url: mcpServerURLSchema, enabled: z.boolean().default(true) }),
  ),
});

export type SettingKey = keyof z.infer<typeof settingsSchema>;

// Keys that are also stored with each chat, moving a key between layers only changes this object.
const chatScope = { model: true, reasoning: true, mode: true } as const;
export const chatSettingsSchema = settingsSchema.pick(chatScope).partial();

/** config.json, written by the operator, so unknown keys are rejected instead of being ignored. */
export const configSchema = z
  .strictObject({
    $schema: z.string().optional(),
    title: z.string().default("BearChat"),
    baseURL: z.string().optional().describe("Inference endpoint, relative to the page or absolute"),
    auth: z.enum(["token", "cookie"]).default("token"),
    models: z.array(z.string()).optional().describe("Allowlist of model ids, in this order"),
    defaults: z.strictObject(settingsSchema.shape).partial().default({}),
    locked: z
      .strictObject(settingsSchema.shape)
      .partial()
      .default({})
      .describe("Settings fixed to these values, whose controls are hidden"),
  })
  .check((context) => {
    const config = context.value;

    if (config.auth === "cookie" && config.baseURL === undefined) {
      context.issues.push({
        code: "custom",
        input: config.baseURL,
        path: ["baseURL"],
        message: "Cookie authentication requires a fixed baseURL",
      });
    }
  });

// Optional as a whole, since older user messages carry no metadata and the AI SDK validates it anyway.
export const metadataSchema = z
  .object({
    model: z.string().optional(),
    createdAt: timestamp.optional(),
    firstTokenAt: timestamp.optional(),
    finishedAt: timestamp.optional(),
    inputTokens: tokens.optional(),
    outputTokens: tokens.optional(),
    totalTokens: tokens.optional(),
  })
  .optional();

export const threadSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: timestamp,
  updatedAt: timestamp,
  settings: chatSettingsSchema,
});

/** Exported chats, whose messages are AI SDK UI messages with attachments embedded as data URLs. */
export const backupSchema = z.strictObject({
  app: z.literal("bearchat"),
  version: z.literal(1),
  threads: z.array(threadSchema.extend({ messages: z.array(z.unknown()) })),
});
