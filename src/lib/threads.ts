import {
  isFileUIPart,
  isToolUIPart,
  safeValidateUIMessages,
  validateUIMessages,
} from "ai";
import { Dexie, liveQuery } from "dexie";
import type { z } from "zod";

import { blobHash, loadBlob, persistBlobs, storeBlob } from "@/lib/blobs";
import { type ChatMessage, deriveTitle, messageText } from "@/lib/chat";
import { dataURL } from "@/lib/convert";
import { db, type MessageRow, type Thread } from "@/lib/db";
import { backupSchema, chatSettingsSchema, metadataSchema, threadSchema } from "@/lib/schemas";
import type { ChatSettings } from "@/lib/settings";
import { createStore } from "@/lib/store";
import { contentResultSchema } from "@/lib/tools/content";
import { memoize, now } from "@/lib/utils";


const importedSettingsSchema = chatSettingsSchema.omit({ mode: true });

/** The messages of a chat in order. */
function messagesOf(threadId: string) {
  return db.messages
    .where("[threadId+position]")
    .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey]);
}

/** The messages of a chat by their primary key, which deletes in one range instead of row by row. */
function messageKeysOf(threadId: string) {
  return db.messages
    .where("[threadId+id]")
    .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey]);
}

async function deleteUnusedBlobs(hashes: string[]) {
  const used = new Set(await db.messages.where("blobs").anyOf(hashes).keys());
  await db.blobs.bulkDelete([...new Set(hashes)].filter((hash) => !used.has(hash)));
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

function blobHashes(message: ChatMessage): string[] {
  return contentURLs(message).flatMap((url) => blobHash(url) ?? []);
}

/**
 * Replaces a chat and its messages in one transaction, which also stores the blobs they reference.
 * The chat is built from the stored one, if any, and only created when asked to.
 * Given the messages of the last save, only the messages that were replaced since are written,
 * since the chat replaces a message object whenever it changes.
 */
function writeThread(
  id: string,
  messages: readonly ChatMessage[],
  create: boolean,
  build: (existing: Thread | undefined) => Thread,
  saved?: readonly ChatMessage[],
) {
  const rows: MessageRow[] = messages.flatMap((message, position) =>
    saved?.[position] === message
      ? []
      : [{ ...message, threadId: id, position, blobs: blobHashes(message) }],
  );
  // the saved messages that are replaced or removed
  const stale = saved?.filter((message, position) => messages[position] !== message);

  return db.transaction("rw", db.threads, db.messages, db.blobs, async () => {
    const existing = await db.threads.get(id);

    // a late save of a deleted chat, e.g. of its aborted response, must not restore it
    if (existing === undefined && !create) {
      return;
    }

    await db.threads.put(build(existing));
    let dropped: string[];

    if (stale === undefined) {
      dropped = (await messagesOf(id).toArray()).flatMap((row) => row.blobs);
      await messageKeysOf(id).delete();
    } else {
      dropped = stale.flatMap(blobHashes);
      await db.messages.bulkDelete(stale.map((message) => [id, message.id]));
    }

    await persistBlobs(rows.flatMap((row) => row.blobs));
    await db.messages.bulkPut(rows);
    await deleteUnusedBlobs(dropped);
  });
}

export async function listThreads(): Promise<Thread[]> {
  const threads = await db.threads.orderBy("updatedAt").reverse().toArray();
  // rows that no longer match the schema are skipped instead of breaking the list
  return threads.flatMap((thread) => threadSchema.safeParse(thread).data ?? []);
}

const threadList = createStore<Thread[]>([]);

/** Keeps the list of chats up to date, also with changes of other tabs, resolving once it is loaded. */
export function watchThreads(): Promise<void> {
  return new Promise((resolve, reject) => {
    liveQuery(listThreads).subscribe({
      next: (threads) => {
        threadList.set(threads);
        resolve();
      },
      error: reject,
    });
  });
}

/** The chats, most recently updated first. */
export function useThreads(): Thread[] {
  return threadList.useValue();
}

/** Loads a chat, skipping messages that no longer match the AI SDK's message format. */
export async function loadThread(id: string) {
  const { thread, rows } = await db.transaction("r", db.threads, db.messages, async () => ({
    thread: await db.threads.get(id),
    rows: await messagesOf(id).toArray(),
  }));
  const stored = rows.map(({ id, role, metadata, parts }) => ({ id, role, metadata, parts }));
  const validate = (messages: unknown[]) =>
    safeValidateUIMessages<ChatMessage>({ messages, metadataSchema });
  const all = await validate(stored);
  // only a chat with invalid messages is validated message by message, to keep the valid ones
  const messages = all.success
    ? all.data
    : (await Promise.all(stored.map((message) => validate([message])))).flatMap(
        (result) => (result.success ? result.data : []),
      );
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

/** The transcripts of the given chats, read in one transaction. */
export async function loadTranscripts(threads: readonly Thread[]): Promise<Transcript[]> {
  const rows = await db.transaction("r", db.messages, () =>
    Promise.all(threads.map((thread) => messagesOf(thread.id).toArray())),
  );
  return threads.map((thread, index) => toTranscript(thread, rows[index]));
}

function writeChat(
  id: string,
  settings: ChatSettings,
  messages: readonly ChatMessage[],
  create: boolean,
  saved?: readonly ChatMessage[],
) {
  const time = now();
  return writeThread(
    id,
    messages,
    create,
    (existing) => ({
      id,
      title: existing?.title ?? deriveTitle(messages),
      createdAt: existing?.createdAt ?? time,
      updatedAt: time,
      settings,
    }),
    saved,
  );
}

/** Saves a new chat, such as a fork. */
export function saveThread(id: string, settings: ChatSettings, messages: readonly ChatMessage[]) {
  return writeChat(id, settings, messages, true);
}

/**
 * Saves the loaded chat whenever it changed, writing only the messages that changed since the last save.
 * The first save creates the chat, later ones only update it, so that a chat deleted meanwhile stays deleted.
 */
export function threadSaver(id: string, loaded: LoadedThread) {
  let exists = loaded.exists;
  // What the database holds, which is unknown if messages were skipped, since their positions are still taken.
  // It only advances once a save is committed, so a failed save is repeated by the next one.
  let saved: readonly ChatMessage[] | undefined = loaded.skipped === 0 ? loaded.messages : undefined;

  return async (settings: ChatSettings, messages: readonly ChatMessage[]) => {
    const create = !exists;
    exists = true;
    await writeChat(id, settings, messages, create, saved);
    saved = messages;
  };
}

export function updateThread(id: string, patch: Partial<Pick<Thread, "title" | "settings">>) {
  return db.threads.update(id, patch);
}

export function deleteThread(id: string) {
  return db.transaction("rw", db.threads, db.messages, db.blobs, async () => {
    const rows = await messagesOf(id).toArray();
    await messageKeysOf(id).delete();
    await db.threads.delete(id);
    await deleteUnusedBlobs(rows.flatMap((row) => row.blobs));
  });
}

/** Exports all chats with their attachments embedded, independent of the database layout. */
export async function exportThreads(): Promise<z.infer<typeof backupSchema>> {
  // content shared by several messages is encoded once
  const encode = memoize(async (url: string) => {
    const data = await loadBlob(url);
    return dataURL(data.type, await data.bytes());
  });
  // one chat at a time, so that only one chat's messages are loaded besides the export itself
  const threads = await Array.fromAsync(await listThreads(), async (thread) => ({
    ...thread,
    messages: await Promise.all(
      (await loadThread(thread.id)).messages.map((message) =>
        mapContentURLsAsync(message, encode),
      ),
    ),
  }));

  // parsed so that the export contains exactly what an import accepts
  return backupSchema.parse({ app: "bearchat", version: 1, threads });
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
