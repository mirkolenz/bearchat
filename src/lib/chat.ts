import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  type ChatTransport,
  type Experimental_DownloadFunction,
  type FileUIPart,
  DirectChatTransport,
  isFileUIPart,
  isTextUIPart,
  stepCountIs,
  ToolLoopAgent,
  type UIMessage,
  type TextUIPart,
  type UITools,
} from "ai";
import { z } from "zod";

import { blobHash, loadBlob } from "@/lib/blobs";
import { metadataSchema } from "@/lib/schemas";
import type { Connection } from "@/lib/connection";
import type { ResolvedSettings } from "@/lib/settings";
import { createTools } from "@/lib/tools";
import { now } from "@/lib/utils";

export type ChatMessage = UIMessage<z.infer<typeof metadataSchema>, never, UITools>;

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

/** Resolves the blob references of attachments and tool results when a request is sent. */
const downloadBlobs: Experimental_DownloadFunction = (requests) =>
  Promise.all(
    requests.map(async ({ url }) => {
      if (blobHash(url.href) === undefined) {
        return null;
      }

      const data = await loadBlob(url.href);
      return { data: await data.bytes(), mediaType: data.type };
    }),
  );


async function textFilePart(part: FileUIPart): Promise<TextUIPart> {
  const text = await (await loadBlob(part.url)).text();
  return { type: "text", text: `<file name=${JSON.stringify(part.filename ?? "file")}>\n${text}\n</file>` };
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
) {
  const { tools, approved, instructions } = await createTools(settings, threadId);
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
    experimental_download: downloadBlobs,
    toolApproval: ({ toolCall }) =>
      approved.has(toolCall.toolName) ? "approved" : approvals[settings.mode],
  });
}

/** Builds the agent per request, so it always uses the current settings and tools. */
export function createTransport(
  connection: Connection,
  settings: ResolvedSettings,
  threadId: string,
): ChatTransport<ChatMessage> {
  return {
    sendMessages: async (options) => {
      let waiting = true;
      const transport = new DirectChatTransport({
        agent: await createAgent(
          connection,
          settings,
          threadId,
          continueSchema.safeParse(options.body).success,
        ),
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
      return transport.sendMessages({
        ...options,
        messages: await Promise.all(options.messages.map(modelMessage)),
      });
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

export function deriveTitle(messages: ChatMessage[]): string {
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
