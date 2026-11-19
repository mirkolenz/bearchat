// One conversion for everything the model reads from files, be it attachments, MCP resources or stored files:
// images become downscaled JPEGs, documents Markdown, text stays text, and anything else is rejected.
import type { DocumentResult } from "@/lib/convert-worker";
import { decodeText } from "@/lib/utils";

// Longest image side, larger photos are downscaled before they are sent and stored.
const maxImageSide = 2048;

// started on first use and kept, so that anydoc, whose WebAssembly build is large, loads once
let documentWorker: Worker | undefined;

/** Converts a document to Markdown in the worker. */
async function convertDocument(bytes: Uint8Array<ArrayBuffer>): Promise<DocumentResult> {
  const worker = (documentWorker ??= new Worker(new URL("./convert-worker.ts", import.meta.url), {
    type: "module",
  }));
  const { port1, port2 } = new MessageChannel();
  const done = new AbortController();

  try {
    return await new Promise<DocumentResult>((resolve, reject) => {
      port1.onmessage = ({ data }: MessageEvent<DocumentResult>) => resolve(data);
      // e.g. if the worker cannot be loaded
      worker.addEventListener(
        "error",
        (event) => reject(new Error(event.message || "The document converter failed to load")),
        { signal: done.signal },
      );
      // the bytes are moved instead of copied, since the caller is done with them
      worker.postMessage(bytes, [port2, bytes.buffer]);
    });
  } finally {
    done.abort();
    port1.close();
  }
}

export function dataURL(mediaType: string, bytes: Uint8Array) {
  return `data:${mediaType};base64,${bytes.toBase64()}`;
}

/** The format of all images, attached or stored, whose names carry its extension. */
export const imageFormat = { mediaType: "image/jpeg", extension: "jpg" } as const;

/** Splits a name into its stem and its extension with the dot, which is empty if there is none. */
export function splitExtension(name: string): [stem: string, extension: string] {
  const dot = name.lastIndexOf(".");
  // a dot that starts the name or one of the directories of a URI begins no extension
  return dot > name.lastIndexOf("/") + 1 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/** Replaces the extension, so that the name matches the converted content. */
function withExtension(name: string, extension: string): string {
  return `${splitExtension(name)[0]}.${extension}`;
}

export function isImageName(name: string): boolean {
  return name.toLowerCase().endsWith(`.${imageFormat.extension}`);
}

/** Re-encodes an image as a JPEG whose longest side is at most maxImageSide. */
async function downscale(file: File): Promise<File> {
  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name} is not an image`);
  }

  const scale = Math.min(1, maxImageSide / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale),
  );
  const context = canvas.getContext("2d");

  if (context === null) {
    throw new Error("Images cannot be processed in this browser");
  }

  // JPEG has no transparency, so transparent areas become white instead of black
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  // the default low quality aliases visibly when downscaling
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: imageFormat.mediaType, quality: 0.9 });
  return new File([blob], withExtension(file.name, imageFormat.extension), {
    type: imageFormat.mediaType,
  });
}

function textFile(name: string, content: BlobPart): File {
  return new File([content], name, { type: "text/plain" });
}

/** Converts a file into a downscaled JPEG, Markdown or text, rejecting other files. */
export async function convertFile(file: File): Promise<File> {
  // SVGs are text, which browsers cannot decode as images without a document
  if (file.type.startsWith("image/") && file.type !== "image/svg+xml") {
    return downscale(file);
  }

  const bytes = await file.bytes();
  // Text is checked first, so that anydoc is only loaded for binary documents.
  // RTF is the one text-based format it converts, which models also read as is.
  if (decodeText(bytes) !== undefined) {
    return textFile(file.name, bytes);
  }

  const result = await convertDocument(bytes);

  if ("unsupported" in result) {
    throw new Error(`${file.name} is not an image, document or text file`);
  }

  if ("error" in result) {
    throw new Error(`${file.name} could not be converted: ${result.error}`);
  }

  return textFile(withExtension(file.name, "md"), result.markdown);
}
