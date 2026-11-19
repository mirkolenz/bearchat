// Binary content of messages, attachments and images in tool results alike, is referenced by URLs
// of this protocol, so messages never hold base64 data. The model receives the bytes when a request is sent.
import type { FileUIPart } from "ai";
import { useEffect, useState } from "react";

import { db } from "@/lib/db";

const protocol = "bearchat-blob:";
// Blobs created or loaded in this session. Saving a chat stores the ones it references,
// so unsent attachments and temporary chats never reach the database.
const session = new Map<string, Blob>();

export function blobHash(url: string): string | undefined {
  const parsed = URL.parse(url);
  return parsed?.protocol === protocol ? parsed.pathname : undefined;
}

/** Keeps a copy of the blob for this session and returns the URL that references it. */
export async function storeBlob(data: Blob): Promise<string> {
  // copied, since a file of the browser storage becomes unreadable once it changes
  const bytes = await data.bytes();
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).toHex();
  session.set(hash, new Blob([bytes], { type: data.type }));
  return protocol + hash;
}

export async function storeFile(file: File): Promise<FileUIPart> {
  return { type: "file", mediaType: file.type, filename: file.name, url: await storeBlob(file) };
}

export async function loadBlob(url: string): Promise<Blob> {
  const hash = blobHash(url);
  const data = hash && (session.get(hash) ?? (await db.blobs.get(hash))?.data);

  if (!hash || !data) {
    throw new Error(`Missing content: ${url}`);
  }

  session.set(hash, data);
  return data;
}

/** Stores the referenced blobs that the database lacks, within the caller's transaction. */
export async function persistBlobs(hashes: string[]) {
  const stored = new Set(await db.blobs.where("hash").anyOf(hashes).primaryKeys());
  await db.blobs.bulkPut(
    [...new Set(hashes)].flatMap((hash) => {
      const data = session.get(hash);
      return stored.has(hash) || data === undefined ? [] : [{ hash, data }];
    }),
  );
}

/** An object URL for the referenced blob, revoked once it is no longer shown. */
export function useBlobURL(url: string): string | undefined {
  const [objectURL, setObjectURL] = useState<string>();

  useEffect(() => {
    let created: string | undefined;
    let active = true;
    // missing content shows the image's alternative text
    loadBlob(url).then(
      (data) => {
        if (active) {
          created = URL.createObjectURL(data);
          setObjectURL(created);
        }
      },
      () => undefined,
    );
    return () => {
      active = false;

      if (created !== undefined) {
        URL.revokeObjectURL(created);
      }
    };
  }, [url]);

  return objectURL;
}
