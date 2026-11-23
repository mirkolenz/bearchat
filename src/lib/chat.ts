import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  type ChatTransport,
  type DynamicToolUIPart,
  type Experimental_DownloadFunction,
  type FileUIPart,
  DirectChatTransport,
  getToolName,
  isFileUIPart,
  isTextUIPart,
  isToolUIPart,
  stepCountIs,
  ToolLoopAgent,
  type ToolUIPart,
  type UIMessage,
  type TextUIPart,
  type Tool,
  type UITools,
} from "ai";
import { z } from "zod";

import { blobHash, loadBlob } from "@/lib/blobs";
import { metadataSchema } from "@/lib/schemas";
import type { Connection } from "@/lib/connection";
import { type ServerErrorHandler, toolServer } from "@/lib/mcp";
import type { ResolvedSettings } from "@/lib/settings";
import { createTools } from "@/lib/tools";
import { memoize, now } from "@/lib/utils";

export type ChatMessage = UIMessage<z.infer<typeof metadataSchema>, never, UITools>;
type ToolPart = ToolUIPart<UITools> | DynamicToolUIPart;

/** Maps the tool calls of a message, which stays the same object if none changed, so saves skip it. */
function mapToolCalls(
  message: ChatMessage,
  map: (part: ToolPart) => ToolPart | undefined,
): ChatMessage {
  const parts = message.parts.flatMap((part) => (isToolUIPart(part) ? (map(part) ?? []) : part));
  return parts.length === message.parts.length &&
    parts.every((part, index) => part === message.parts[index])
    ? message
    : { ...message, parts };
}

/** Denies the approved tool calls that have not run yet and that select picks. */
export function denyApprovals(
  message: ChatMessage,
  reason: string,
  select: (part: ToolPart) => boolean,
): ChatMessage {
  return mapToolCalls(message, (part) =>
    part.state === "approval-responded" && select(part)
      ? {
          ...part,
          state: "output-denied",
          approval: { ...part.approval, approved: false, reason },
        }
      : part,
  );
}

/**
 * Ends the tool calls that a stopped or failed reply left unfinished,
 * which the next request could not continue otherwise.
 */
export function settleToolCalls(message: ChatMessage): ChatMessage {
  return mapToolCalls(message, (part) => {
    switch (part.state) {
      // the call is incomplete, so there is nothing to report
      case "input-streaming":
        return undefined;
      case "input-available":
        return {
          ...part,
          state: "output-error",
          errorText: "The reply stopped before the tool finished",
        };
      default:
        return part;
    }
  });
}

const approvals = {
  allow: "approved",
  ask: "user-approval",
  deny: { type: "denied", reason: "MCP tools with side effects are disabled in this chat" },
} as const;

// lets vLLM extend the last assistant message when a reply is continued
const continuation = { continue_final_message: true, add_generation_prompt: false };
export const continueRequest = { body: { continue: true } };
const continueSchema = z.object({ continue: z.literal(true) });

/**
 * Takes only configured text, so the prompt is identical across requests and servers reuse
 * the cached prefix. The time is part of the user messages instead, see modelMessage.
 */
function systemPrompt(instructions: string, serverInstructions: string[]): string {
  return [instructions, ...serverInstructions].filter(Boolean).join("\n\n");
}

/**
 * Resolves the blob references of attachments and tool results when a request is sent.
 * Each step of the agent sends all of them again, so they are read once per request.
 */
function blobDownloader(): Experimental_DownloadFunction {
  const download = memoize(async (url: string) => {
    const data = await loadBlob(url);
    return { data: await data.bytes(), mediaType: data.type };
  });
  return (requests) =>
    Promise.all(
      requests.map(async ({ url: { href } }) =>
        blobHash(href) === undefined ? null : download(href),
      ),
    );
}

async function textFilePart(part: FileUIPart): Promise<TextUIPart> {
  const text = await (await loadBlob(part.url)).text();
  return {
    type: "text",
    text: `<file name=${JSON.stringify(part.filename ?? "file")}>\n${text}\n</file>`,
  };
}

/**
 * Prepares a message for the model. Text attachments are inlined, since OpenAI-compatible servers
 * only accept media files. User messages start with the time they were sent, which tells the model
 * the current time and how much time passed in between. Unlike a time in the system prompt,
 * the stamps never change, so servers can reuse the cached prefix.
 */
async function modelMessage(message: ChatMessage): Promise<ChatMessage> {
  const parts = await Promise.all(
    message.parts.map(async (part) =>
      isFileUIPart(part) && part.mediaType === "text/plain" ? textFilePart(part) : part,
    ),
  );
  const sentAt = message.role === "user" ? message.metadata?.createdAt : undefined;

  if (sentAt === undefined) {
    return { ...message, parts };
  }

  const sent = Temporal.Instant.fromEpochMilliseconds(sentAt).toZonedDateTimeISO(
    Temporal.Now.timeZoneId(),
  );
  // English, so that the stamps of earlier messages do not change with the browser's language
  const time = sent.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" });
  // templates such as Qwen's join text parts without a separator
  const stamp: TextUIPart = { type: "text", text: `[Sent ${time}, ${sent.timeZoneId}]\n\n` };
  return { ...message, parts: [stamp, ...parts] };
}

async function createAgent(
  connection: Connection,
  settings: ResolvedSettings,
  threadId: string,
  continuing: boolean,
  onServerError: ServerErrorHandler,
) {
  const { tools, approved, instructions } = await createTools(settings, threadId, onServerError);
  const provider = createOpenAICompatible({
    name: "bearchat",
    baseURL: connection.baseURL,
    apiKey: connection.apiKey,
    includeUsage: true,
    // vLLM and llama.cpp enforce JSON schemas through guided decoding
    supportsStructuredOutputs: true,
    // MCP results are content parts, which would otherwise be sent as JSON with images as base64 text
    supportsMultiPartToolContent: true,
    transformRequestBody: (body) => ({
      ...body,
      ...settings.requestBody,
      ...(continuing ? continuation : {}),
    }),
  });

  return new ToolLoopAgent({
    model: provider.chatModel(settings.model),
    instructions: systemPrompt(settings.instructions, instructions),
    reasoning: settings.reasoning,
    tools,
    // sorted by name, so the tool definitions stay a stable part of the cached prompt prefix
    toolOrder: [],
    // the default of 20 steps cuts off longer tasks with the file tools
    stopWhen: stepCountIs(100),
    experimental_download: blobDownloader(),
    toolApproval: ({ toolCall }) =>
      approved.has(toolCall.toolName) ? "approved" : approvals[settings.mode],
  });
}

/** Builds the agent per request, so it always uses the current settings and tools. */
export function createTransport(
  connection: Connection,
  settings: ResolvedSettings,
  threadId: string,
  onServerError: ServerErrorHandler,
): ChatTransport<ChatMessage> {
  return {
    sendMessages: async (options) => {
      let waiting = true;
      // the attachments are read while the MCP servers are reached
      const [agent, prepared] = await Promise.all([
        createAgent(
          connection,
          settings,
          threadId,
          continueSchema.safeParse(options.body).success,
          onServerError,
        ),
        Promise.all(options.messages.map(modelMessage)),
      ]);
      // the user approved the calls for the server that requested them,
      // which may no longer be the server of the tool with that name
      const messages = prepared.map((message) =>
        denyApprovals(message, "The MCP server changed since the call was requested", (part) => {
          const tool: Tool | undefined = agent.tools[getToolName(part)];
          return toolServer(part.toolMetadata) !== toolServer(tool?.metadata);
        }),
      );
      const transport = new DirectChatTransport({
        agent,
        messageMetadata: ({ part }) => {
          switch (part.type) {
            case "start":
              return { model: settings.model, createdAt: now() };
            case "text-delta":
            case "reasoning-delta":
              if (waiting) {
                waiting = false;
                return { firstTokenAt: now() };
              }

              return undefined;
            case "finish":
              return {
                finishedAt: now(),
                inputTokens: part.totalUsage.inputTokens,
                outputTokens: part.totalUsage.outputTokens,
                totalTokens: part.totalUsage.totalTokens,
              };
            default:
              return undefined;
          }
        },
      });
      return transport.sendMessages({ ...options, messages });
    },
    reconnectToStream: async () => null,
  };
}

export function messageText(message: ChatMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("\n\n");
}

export function deriveTitle(messages: readonly ChatMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  const text = first ? messageText(first).replaceAll(/\s+/g, " ").trim() : "";
  return text.length > 60 ? `${text.slice(0, 60)}…` : text || "New chat";
}

export function toMarkdown(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      const author = message.role === "user" ? "User" : (message.metadata?.model ?? "Assistant");
      return `## ${author}\n\n${messageText(message)}`;
    })
    .join("\n\n");
}
