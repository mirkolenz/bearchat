import { tool } from "ai";
import { z } from "zod";

import type { ChatMessage } from "@/lib/chat";
import { loadTranscript, loadTranscripts } from "@/lib/threads";
import { rangeSchema, sliceRange } from "@/lib/tools/range";
import { formatTime } from "@/lib/utils";

const excerptLength = 300;
const maxExcerpts = 3;

/** A message as both tools show it, numbered like the ranges of read_chat. */
function messageLine(number: number, role: ChatMessage["role"], text: string): string {
  return `#${number} ${role}: ${text}`;
}

/** Text around the first of the lowercase terms, found in the lowercased text. */
function excerpt(text: string, lower: string, terms: string[]): string | undefined {
  const index = Math.min(...terms.map((term) => lower.indexOf(term)).filter((i) => i >= 0));

  if (!Number.isFinite(index)) {
    return undefined;
  }

  const start = Math.max(0, index - excerptLength / 3);
  const end = start + excerptLength;
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** Tools for the saved chats, hiding the current one, which the model already sees. */
export function createChatTools(currentId: string) {
  return {
    search_chats: tool({
      description:
        "Search the user's other saved chats, most recently updated first. " +
        "With a query, only chats whose title or messages contain all of its words (case-insensitive) are returned, " +
        "with excerpts of the matching messages. Without a query, the most recent chats are listed. " +
        "Use read_chat with a chat's id to read its messages.",
      inputSchema: z.object({
        query: z.string().optional().describe("Words to find, all chats if omitted"),
        limit: z.int().min(1).max(100).optional().describe("Maximum number of chats, default 10"),
      }),
      execute: async ({ query = "", limit = 10 }) => {
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        return (await loadTranscripts())
          .values()
          .filter(({ thread }) => thread.id !== currentId)
          .flatMap(({ thread, messages }) => {
            const lowered = messages.map((message) => message.text.toLowerCase());
            const texts = [thread.title.toLowerCase(), ...lowered];

            if (!terms.every((term) => texts.some((text) => text.includes(term)))) {
              return [];
            }

            const excerpts = messages.flatMap(({ role, text }, index) => {
              const found = excerpt(text, lowered[index], terms);
              return found === undefined ? [] : [messageLine(index + 1, role, found)];
            });
            return [
              {
                id: thread.id,
                title: thread.title,
                updated: formatTime(thread.updatedAt),
                messages: messages.length,
                excerpts: excerpts.slice(0, maxExcerpts),
              },
            ];
          })
          .take(limit)
          .toArray();
      },
    }),
    read_chat: tool({
      description:
        "Read the text of a saved chat's messages by its id, optionally only a range of them. " +
        "Tool calls and attachments are left out.",
      inputSchema: z.object({ id: z.string() }).extend(rangeSchema("message").shape),
      execute: async ({ id, ...range }) => {
        const transcript = await loadTranscript(id);

        if (transcript === undefined) {
          throw new Error(`No saved chat has the id ${id}`);
        }

        const { start = 1 } = range;
        return {
          title: transcript.thread.title,
          total_messages: transcript.messages.length,
          messages: sliceRange(transcript.messages, range).map(
            ({ role, text }, index) => messageLine(start + index, role, text),
          ),
        };
      },
    }),
  };
}
