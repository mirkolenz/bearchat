import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  type ChatTransport,
  DirectChatTransport,
  isFileUIPart,
  isTextUIPart,
  ToolLoopAgent,
  type UIMessage,
  type TextUIPart,
  type UITools,
} from "ai";
import { z } from "zod";

import { attachmentText } from "@/lib/attachments";
import { metadataSchema } from "@/lib/schemas";
import type { Connection } from "@/lib/connection";
import type { ResolvedSettings } from "@/lib/settings";
import { createTools } from "@/lib/tools";

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

function systemPrompt(instructions: string, serverInstructions: string[]): string {
  const now = new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [instructions, ...serverInstructions, `The current date and time is ${now} (${timeZone}).`]
    .filter(Boolean)
    .join("\n\n");
}

// OpenAI-compatible servers only accept media files, so text attachments are inlined.
async function inlineTextFiles(message: ChatMessage): Promise<ChatMessage> {
  if (!message.parts.some((part) => isFileUIPart(part) && part.mediaType === "text/plain")) {
    return message;
  }

  const parts = await Promise.all(
    message.parts.map(async (part) =>
      isFileUIPart(part) && part.mediaType === "text/plain"
        ? ({
            type: "text",
            text: `<file name=${JSON.stringify(part.filename ?? "file")}>\n${await attachmentText(part)}\n</file>`,
          } satisfies TextUIPart)
        : part,
    ),
  );
  return { ...message, parts };
}

async function createAgent(
  connection: Connection,
  settings: ResolvedSettings,
  continuing: boolean,
) {
  const { tools, approved, instructions } = await createTools(settings);
  const provider = createOpenAICompatible({
    name: "bearchat",
    baseURL: connection.baseURL,
    apiKey: connection.apiKey,
    includeUsage: true,
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
    toolApproval: ({ toolCall }) =>
      approved.has(toolCall.toolName) ? "approved" : approvals[settings.mode],
  });
}

/** Builds the agent per request, so it always uses the current settings and tools. */
export function createTransport(
  connection: Connection,
  settings: ResolvedSettings,
): ChatTransport<ChatMessage> {
  return {
    sendMessages: async (options) => {
      let waiting = true;
      const transport = new DirectChatTransport({
        agent: await createAgent(
          connection,
          settings,
          continueSchema.safeParse(options.body).success,
        ),
        messageMetadata: ({ part }) => {
          switch (part.type) {
            case "start":
              return { model: settings.model, createdAt: Date.now() };
            case "text-delta":
            case "reasoning-delta":
              if (waiting) {
                waiting = false;
                return { firstTokenAt: Date.now() };
              }

              return undefined;
            case "finish":
              return {
                finishedAt: Date.now(),
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
        messages: await Promise.all(options.messages.map(inlineTextFiles)),
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
