import {
  isFileUIPart,
  isToolUIPart,
  safeValidateUIMessages,
  validateUIMessages,
} from "ai";
import { Dexie } from "dexie";
import type { z } from "zod";

import { blobHash, loadBlob, persistBlobs, storeBlob } from "@/lib/blobs";
import { type ChatMessage, deriveTitle, messageText } from "@/lib/chat";
import { dataURL } from "@/lib/convert";
import { db, type MessageRow, type Thread } from "@/lib/db";
import { backupSchema, chatSettingsSchema, metadataSchema, threadSchema } from "@/lib/schemas";
import type { ChatSettings } from "@/lib/settings";
import { contentResultSchema } from "@/lib/tools/content";
import { now } from "@/lib/utils";


const importedSettingsSchema = chatSettingsSchema.omit({ mode: true });

function messagesOf(threadId: string) {
  return db.messages
    .where("[threadId+position]")
    .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey]);
}

async function deleteUnusedBlobs(hashes: string[]) {
  for (const hash of new Set(hashes)) {
    if ((await db.messages.where("blobs").equals(hash).count()) === 0) {
      await db.blobs.delete(hash);
    }
  }
}

/** Rewrites the URLs of a message's binary content, in file parts and in the images of tool results. */
function mapContentURLs(message: ChatMessage, map: (url: string) => string): ChatMessage {
  const parts = message.parts.map((part) => {
    if (isFileUIPart(part)) {
      return { ...part, url: map(part.url) };
    }

    if (!isToolUIPart(part) || part.state !== "output-available") {
      return part;
    }

    const result = contentResultSchema.safeParse(part.output);

    if (!result.success) {
      return part;
    }

    const content = result.data.content.map((item) =>
      item.type === "resource_link" ? { ...item, uri: map(item.uri) } : item,
    );
    return { ...part, output: { content } };
  });
  return { ...message, parts };
}

/** The URLs of a message's binary content, collected by the same traversal that rewrites them. */
function contentURLs(message: ChatMessage): string[] {
  const urls: string[] = [];
  mapContentURLs(message, (url) => {
    urls.push(url);
    return url;
  });
  return urls;
}

async function mapContentURLsAsync(
  message: ChatMessage,
  map: (url: string) => Promise<string>,
): Promise<ChatMessage> {
  const urls = [...new Set(contentURLs(message))];
  const mapped = new Map(await Promise.all(urls.map(async (url) => [url, await map(url)] as const)));
  return mapContentURLs(message, (url) => mapped.get(url) ?? url);
}

/**
 * Replaces a chat and its messages in one transaction, which also stores the blobs they reference.
 * The chat is built from the stored one, if any, and only created when asked to.
 */
function writeThread(
  id: string,
  messages: ChatMessage[],
  create: boolean,
  build: (existing: Thread | undefined) => Thread,
) {
  const rows: MessageRow[] = messages.map((message, position) => ({
    ...message,
    threadId: id,
    position,
    blobs: contentURLs(message).flatMap((url) => blobHash(url) ?? []),
  }));

  return db.transaction("rw", db.tables, async () => {
    const existing = await db.threads.get(id);

    // a late save of a deleted chat, e.g. of its aborted response, must not restore it
    if (existing === undefined && !create) {
      return;
    }

    const previous = await messagesOf(id).toArray();
    await db.threads.put(build(existing));
    await messagesOf(id).delete();
    await persistBlobs(rows.flatMap((row) => row.blobs));
    await db.messages.bulkPut(rows);
    await deleteUnusedBlobs(previous.flatMap((row) => row.blobs));
  });
}

export async function listThreads(): Promise<Thread[]> {
  const threads = await db.threads.orderBy("updatedAt").reverse().toArray();
  // rows that no longer match the schema are skipped instead of breaking the list
  return threads.flatMap((thread) => threadSchema.safeParse(thread).data ?? []);
}

/** Loads a chat, skipping messages that no longer match the AI SDK's message format. */
export async function loadThread(id: string) {
  const { thread, rows } = await db.transaction("r", db.threads, db.messages, async () => ({
    thread: await db.threads.get(id),
    rows: await messagesOf(id).toArray(),
  }));
  const results = await Promise.all(
    rows.map(({ id, role, metadata, parts }) =>
      safeValidateUIMessages<ChatMessage>({
        messages: [{ id, role, metadata, parts }],
        metadataSchema,
      }),
    ),
  );
  const messages = results.flatMap((result) => (result.success ? result.data : []));
  return {
    messages,
    // whether the chat is stored, which new and deleted chats are not
    exists: thread !== undefined,
    // invalid chat settings are dropped, so the chat falls back to the user settings
    settings: chatSettingsSchema.safeParse(thread?.settings).data ?? {},
    skipped: rows.length - messages.length,
  };
}

export type LoadedThread = Awaited<ReturnType<typeof loadThread>>;

export interface Transcript {
  thread: Thread;
  messages: { role: ChatMessage["role"]; text: string }[];
}

/** The text of a chat's messages without their attachments, skipping messages without text. */
function toTranscript(thread: Thread, rows: MessageRow[]): Transcript {
  const messages = rows.flatMap((row) => {
    const text = messageText(row);
    return text ? [{ role: row.role, text }] : [];
  });
  return { thread, messages };
}

export async function loadTranscript(id: string): Promise<Transcript | undefined> {
  const { thread, rows } = await db.transaction("r", db.threads, db.messages, async () => ({
    thread: await db.threads.get(id),
    rows: await messagesOf(id).toArray(),
  }));
  const parsed = threadSchema.safeParse(thread);
  return parsed.success ? toTranscript(parsed.data, rows) : undefined;
}

/** The transcripts of all chats, most recently updated first, read in one transaction. */
export async function loadTranscripts(): Promise<Transcript[]> {
  const { threads, rows } = await db.transaction("r", db.threads, db.messages, async () => ({
    threads: await listThreads(),
    rows: await db.messages.orderBy("[threadId+position]").toArray(),
  }));
  const grouped = Map.groupBy(rows, (row) => row.threadId);
  return threads.map((thread) => toTranscript(thread, grouped.get(thread.id) ?? []));
}

/** Saves a chat, which is only created when asked to, so that deleted chats stay deleted. */
export function saveThread(
  id: string,
  settings: ChatSettings,
  messages: ChatMessage[],
  create: boolean,
) {
  const time = now();
  return writeThread(id, messages, create, (existing) => ({
    id,
    title: existing?.title ?? deriveTitle(messages),
    createdAt: existing?.createdAt ?? time,
    updatedAt: time,
    settings,
  }));
}

export function updateThread(id: string, patch: Partial<Pick<Thread, "title" | "settings">>) {
  return db.threads.update(id, patch);
}

export function deleteThread(id: string) {
  return db.transaction("rw", db.tables, async () => {
    const rows = await messagesOf(id).toArray();
    await messagesOf(id).delete();
    await db.threads.delete(id);
    await deleteUnusedBlobs(rows.flatMap((row) => row.blobs));
  });
}

/** Exports all chats with their attachments embedded, independent of the database layout. */
export async function exportThreads(): Promise<z.infer<typeof backupSchema>> {
  const threads = await listThreads();
  // parsed so that the export contains exactly what an import accepts
  return backupSchema.parse({
    app: "bearchat",
    version: 1,
    threads: await Promise.all(
      threads.map(async (thread) => ({
        ...thread,
        messages: await Promise.all(
          (await loadThread(thread.id)).messages.map((message) =>
            mapContentURLsAsync(message, async (url) => {
              const data = await loadBlob(url);
              return dataURL(data.type, await data.bytes());
            }),
          ),
        ),
      })),
    ),
  });
}

/** Imports a backup, replacing chats with the same id. */
export async function importThreads(data: unknown): Promise<number> {
  const backup = backupSchema.parse(data);
  const threads = await Promise.all(
    backup.threads.map(async ({ messages, settings, ...thread }) => {
      const validated =
        messages.length === 0
          ? []
          : await validateUIMessages<ChatMessage>({ messages, metadataSchema });
      // embedded content only, so that importing never fetches remote URLs
      const stored = await Promise.all(
        validated.map((message) =>
          mapContentURLsAsync(message, async (url) => {
            if (URL.parse(url)?.protocol !== "data:") {
              throw new Error(`The chat "${thread.title}" has content that is not embedded`);
            }

            return storeBlob(await (await fetch(url)).blob());
          }),
        ),
      );

      // a shared backup must not grant tool permissions, so chats use the user's execution mode
      return {
        thread: { ...thread, settings: importedSettingsSchema.parse(settings) },
        messages: stored,
      };
    }),
  );

  for (const { thread, messages } of threads) {
    await writeThread(thread.id, messages, true, () => thread);
  }

  return threads.length;
}
