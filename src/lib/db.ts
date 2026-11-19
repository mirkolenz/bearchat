import { Dexie, type EntityTable, type Table } from "dexie";
import type { z } from "zod";

import type { ChatMessage } from "@/lib/chat";
import type { threadSchema } from "@/lib/schemas";

export type Thread = z.infer<typeof threadSchema>;

// A chat as stored, whose revision counts the saves of its messages, so a save notices writes of others.
// Rows of earlier versions have none, which counts as zero.
export interface ThreadRow extends Thread {
  revision?: number;
}

// A message as the chat holds it, whose binary content references blobs.
export interface MessageRow extends ChatMessage {
  threadId: string;
  position: number;
  // indexed to find blobs that are no longer referenced
  blobs: string[];
}

// Binary content is stored once per content, keyed by its SHA-256 hash.
interface BlobRow {
  hash: string;
  data: Blob;
}

class Database extends Dexie {
  declare threads: EntityTable<ThreadRow, "id">;
  declare messages: Table<MessageRow, [string, string]>;
  declare blobs: EntityTable<BlobRow, "hash">;

  constructor() {
    super("bearchat");
    this.version(1).stores({
      threads: "id, updatedAt",
      // forks copy messages with their ids, so the key includes the thread
      messages: "[threadId+id], [threadId+position], *blobs",
      blobs: "hash",
    });
  }
}

export const db = new Database();
