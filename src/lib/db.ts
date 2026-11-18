import { type FileUIPart, isFileUIPart, safeValidateUIMessages, validateUIMessages } from "ai";
import { Dexie, type EntityTable, type Table } from "dexie";
import type { z } from "zod";

import { dataURL } from "@/lib/attachments";
import { type ChatMessage, deriveTitle } from "@/lib/chat";
import { backupSchema, chatSettingsSchema, metadataSchema, threadSchema } from "@/lib/schemas";
import type { ChatSettings } from "@/lib/settings";

export type Thread = z.infer<typeof threadSchema>;

// An AI SDK message whose file parts reference blobs instead of embedding data URLs.
interface MessageRow extends ChatMessage {
  threadId: string;
  position: number;
  // indexed to find blobs that are no longer referenced
  blobs: string[];
}

// Attachments are stored once per content, keyed by their SHA-256 hash.
interface BlobRow {
  hash: string;
  data: Blob;
}

class Database extends Dexie {
  declare threads: EntityTable<Thread, "id">;
  declare messages: Table<MessageRow, [string, string]>;
  declare blobs: EntityTable<BlobRow, "hash">;

  constructor() {
    super("bearchat");
    this.version(2)
      .stores({
        threads: "id, updatedAt",
        // forks copy messages with their ids, so the key includes the thread
        messages: "[threadId+id], [threadId+position], *blobs",
        blobs: "hash",
        transcripts: null,
      })
      // the first version is dropped without migration
      .upgrade((transaction) => transaction.table("threads").clear());
  }
}

const db = new Database();
const importedSettingsSchema = chatSettingsSchema.omit({ mode: true });

const blobProtocol = "bearchat-blob:";
// hashes of file parts that are known to be stored, so saving does not hash them again
const storedHashes = new WeakMap<FileUIPart, string>();

function blobHash(url: string): string | undefined {
  const parsed = URL.parse(url);
  return parsed?.protocol === blobProtocol ? parsed.pathname : undefined;
}

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

/** Moves the data URLs of file parts into blobs, outside of transactions since hashing is asynchronous. */
async function toRow(message: ChatMessage, threadId: string, position: number) {
  const blobs: BlobRow[] = [];
  const parts = await Promise.all(
    message.parts.map(async (part) => {
      if (!isFileUIPart(part)) {
        return part;
      }

      let hash = storedHashes.get(part) ?? blobHash(part.url);

      if (hash === undefined) {
        const data = await (await fetch(part.url)).blob();
        hash = new Uint8Array(
          await crypto.subtle.digest("SHA-256", await data.arrayBuffer()),
        ).toHex();
        blobs.push({ hash, data });
      }

      return { ...part, url: blobProtocol + hash };
    }),
  );
  const hashes = parts.flatMap((part) => (isFileUIPart(part) ? (blobHash(part.url) ?? []) : []));
  const row: MessageRow = { ...message, parts, threadId, position, blobs: hashes };
  return { row, blobs };
}

async function toMessage(row: MessageRow, blobs: Map<string, Blob>): Promise<ChatMessage> {
  const parts = await Promise.all(
    row.parts.map(async (part) => {
      const hash = isFileUIPart(part) ? blobHash(part.url) : undefined;
      const blob = hash === undefined ? undefined : blobs.get(hash);

      if (!isFileUIPart(part) || hash === undefined || blob === undefined) {
        return part;
      }

      const restored = { ...part, url: dataURL(part.mediaType, await blob.bytes()) };
      storedHashes.set(restored, hash);
      return restored;
    }),
  );
  return { id: row.id, role: row.role, metadata: row.metadata, parts };
}

async function writeThread(thread: Thread, messages: ChatMessage[]) {
  const converted = await Promise.all(
    messages.map((message, position) => toRow(message, thread.id, position)),
  );

  await db.transaction("rw", db.tables, async () => {
    const previous = await messagesOf(thread.id).toArray();
    await db.threads.put(thread);
    await messagesOf(thread.id).delete();
    await db.blobs.bulkPut(converted.flatMap((entry) => entry.blobs));
    await db.messages.bulkPut(converted.map((entry) => entry.row));
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
  const { thread, rows, blobs } = await db.transaction("r", db.tables, async () => {
    const rows = await messagesOf(id).toArray();
    const hashes = [...new Set(rows.flatMap((row) => row.blobs))];
    const blobRows = await db.blobs.bulkGet(hashes);
    return {
      thread: await db.threads.get(id),
      rows,
      blobs: new Map(blobRows.flatMap((blob) => (blob ? [[blob.hash, blob.data] as const] : []))),
    };
  });
  const results = await Promise.all(
    rows.map(async (row) =>
      safeValidateUIMessages<ChatMessage>({
        messages: [await toMessage(row, blobs)],
        metadataSchema,
      }),
    ),
  );
  const messages = results.flatMap((result) => (result.success ? result.data : []));
  return {
    messages,
    // invalid chat settings are dropped, so the chat falls back to the user settings
    settings: chatSettingsSchema.safeParse(thread?.settings).data ?? {},
    skipped: rows.length - messages.length,
  };
}

export type LoadedThread = Awaited<ReturnType<typeof loadThread>>;

export async function saveThread(id: string, settings: ChatSettings, messages: ChatMessage[]) {
  const existing = await db.threads.get(id);
  const now = Date.now();
  await writeThread(
    {
      id,
      title: existing?.title ?? deriveTitle(messages),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      settings,
    },
    messages,
  );
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
    version: 2,
    threads: await Promise.all(
      threads.map(async (thread) => ({
        ...thread,
        messages: (await loadThread(thread.id)).messages,
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
      // embedded attachments only, so that importing never fetches remote URLs
      const remote = validated.some((message) =>
        message.parts.some(
          (part) => isFileUIPart(part) && URL.parse(part.url)?.protocol !== "data:",
        ),
      );

      if (remote) {
        throw new Error(`The chat "${thread.title}" has attachments that are not embedded`);
      }

      // a shared backup must not grant tool permissions, so chats use the user's execution mode
      return {
        thread: { ...thread, settings: importedSettingsSchema.parse(settings) },
        messages: validated,
      };
    }),
  );

  for (const { thread, messages } of threads) {
    await writeThread(thread, messages);
  }

  return threads.length;
}
