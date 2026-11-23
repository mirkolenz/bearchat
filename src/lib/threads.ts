import { isFileUIPart, isToolUIPart, safeValidateUIMessages, validateUIMessages } from "ai";
import { Dexie, liveQuery } from "dexie";
import type { z } from "zod";

import { blobHash, loadBlob, persistBlobs, storeBlob } from "@/lib/blobs";
import { type ChatMessage, denyApprovals, deriveTitle, messageText } from "@/lib/chat";
import { dataURL } from "@/lib/convert";
import { db, type MessageRow, type Thread } from "@/lib/db";
import { backupSchema, chatSettingsSchema, metadataSchema, threadSchema } from "@/lib/schemas";
import type { ChatSettings } from "@/lib/settings";
import { createStore } from "@/lib/store";
import { contentResultSchema } from "@/lib/tools/content";
import { forgetPythonState } from "@/lib/tools/python";
import { downloadFile, exclusive, memoize, now } from "@/lib/utils";

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
  const mapped = new Map(
    await Promise.all(urls.map(async (url) => [url, await map(url)] as const)),
  );
  return mapContentURLs(message, (url) => mapped.get(url) ?? url);
}

function blobHashes(message: ChatMessage): string[] {
  return contentURLs(message).flatMap((url) => blobHash(url) ?? []);
}

/** What a saver last saw of a chat. */
interface Base {
  // the stored revision, undefined for a chat that is not stored yet
  revision?: number;
  // the messages of that revision, undefined if unknown, which writes all messages
  messages?: readonly ChatMessage[];
}

/**
 * Replaces a chat and its messages in one transaction, which also stores the blobs they reference,
 * and resolves to the new revision.
 * Without a base, the chat is written as given, as by imports and forks.
 * Given the base a saver last saw, only the messages that were replaced since are written,
 * since the chat replaces a message object whenever it changes.
 * If the stored chat is no longer that base, nothing is written,
 * since the saver would discard the changes of another tab.
 */
function writeThread(
  id: string,
  messages: readonly ChatMessage[],
  build: (existing: Thread | undefined) => Thread,
  base?: Base,
): Promise<number | "deleted" | "changed"> {
  return db.transaction("rw", db.threads, db.messages, db.blobs, async () => {
    const existing = await db.threads.get(id);
    // rows of earlier versions have no revision, which counts as zero
    const stored = existing && (existing.revision ?? 0);

    if (base !== undefined && stored !== base.revision) {
      // a late save of a deleted chat, e.g. of its aborted response, must not restore it
      return stored === undefined ? "deleted" : "changed";
    }

    const saved = base?.messages;
    const rows: MessageRow[] = messages.flatMap((message, position) =>
      saved?.[position] === message
        ? []
        : [{ ...message, threadId: id, position, blobs: blobHashes(message) }],
    );
    let dropped: string[];

    if (saved === undefined) {
      dropped = (await messagesOf(id).toArray()).flatMap((row) => row.blobs);
      await messageKeysOf(id).delete();
    } else {
      // the saved messages that are replaced or removed
      const stale = saved.filter((message, position) => messages[position] !== message);
      dropped = stale.flatMap(blobHashes);
      await db.messages.bulkDelete(stale.map((message) => [id, message.id]));
    }

    const revision = (stored ?? 0) + 1;
    await db.threads.put({ ...build(existing), revision });
    await persistBlobs(rows.flatMap((row) => row.blobs));
    await db.messages.bulkPut(rows);
    await deleteUnusedBlobs(dropped);
    return revision;
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
    : (await Promise.all(stored.map((message) => validate([message])))).flatMap((result) =>
        result.success ? result.data : [],
      );
  return {
    messages,
    // undefined if the chat is not stored, which new and deleted chats are not
    revision: thread === undefined ? undefined : (thread.revision ?? 0),
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
  base?: Base,
) {
  const time = now();
  return writeThread(
    id,
    messages,
    (existing) => ({
      id,
      title: existing?.title ?? deriveTitle(messages),
      createdAt: existing?.createdAt ?? time,
      updatedAt: time,
      settings,
    }),
    base,
  );
}

/** Saves a new chat, such as a fork. */
export function saveThread(id: string, settings: ChatSettings, messages: readonly ChatMessage[]) {
  return writeChat(id, settings, messages);
}

/**
 * Saves the loaded chat whenever it changed, writing only the messages that changed since the last save.
 * The first save creates the chat, later ones only update it, so that a chat deleted meanwhile stays deleted.
 * If another tab saved the chat meanwhile, this tab continues in a fork, which is passed to onFork,
 * so that neither tab discards the replies of the other.
 * Saves of a chat run one at a time, also across tabs, so a slow save never overwrites a later one.
 */
export function threadSaver(id: string, loaded: LoadedThread, onFork: (id: string) => void) {
  let target = id;
  // Only advances once a save is committed, so a failed save is repeated by the next one.
  // The messages are unknown if some were skipped, since their positions are still taken.
  let base: Base = {
    revision: loaded.revision,
    messages: loaded.skipped === 0 ? loaded.messages : undefined,
  };

  return (settings: ChatSettings, messages: readonly ChatMessage[]) =>
    exclusive(`thread:${id}`, async () => {
      let result = await writeChat(target, settings, messages, base);

      if (result === "changed") {
        target = crypto.randomUUID();
        result = await saveThread(target, settings, messages);
        onFork(target);
      }

      if (typeof result === "number") {
        base = { revision: result, messages };
      }
    });
}

export function updateThread(id: string, patch: Partial<Pick<Thread, "title" | "settings">>) {
  return db.threads.update(id, patch);
}

/** Deletes chats with their messages in one transaction, and the blobs no other chat references. */
export function deleteThreads(ids: readonly string[]) {
  for (const id of ids) {
    forgetPythonState(id);
  }

  return db.transaction("rw", db.threads, db.messages, db.blobs, async () => {
    const rows = await Promise.all(ids.map((id) => messagesOf(id).toArray()));
    await Promise.all(ids.map((id) => messageKeysOf(id).delete()));
    await db.threads.bulkDelete([...ids]);
    await deleteUnusedBlobs(rows.flat().flatMap((row) => row.blobs));
  });
}

/** Exports the given chats, or all of them, with their attachments embedded, independent of the database layout. */
async function exportThreads(ids?: readonly string[]): Promise<z.infer<typeof backupSchema>> {
  const selected = ids && new Set(ids);
  // content shared by several messages is encoded once
  const encode = memoize(async (url: string) => {
    const data = await loadBlob(url);
    return dataURL(data.type, await data.bytes());
  });
  // one chat at a time, so that only one chat's messages are loaded besides the export itself
  const listed = (await listThreads()).filter((thread) => selected?.has(thread.id) ?? true);
  const threads = await Array.fromAsync(listed, async (thread) => ({
    ...thread,
    messages: await Promise.all(
      (await loadThread(thread.id)).messages.map((message) => mapContentURLsAsync(message, encode)),
    ),
  }));

  // parsed so that the export contains exactly what an import accepts
  return backupSchema.parse({ app: "bearchat", version: 1, threads });
}

/** Downloads a backup of the given chats, or of all of them, which importThreads restores. */
export async function downloadBackup(ids?: readonly string[]): Promise<void> {
  downloadFile(
    `bearchat-${Temporal.Now.plainDateISO().toString()}.json`,
    JSON.stringify(await exportThreads(ids)),
    "application/json",
  );
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
        messages: stored.map((message) =>
          // the next request would otherwise run them
          denyApprovals(message, "Approvals of imported chats do not carry over", () => true),
        ),
      };
    }),
  );

  for (const { thread, messages } of threads) {
    await writeThread(thread.id, messages, () => thread);
  }

  return threads.length;
}
