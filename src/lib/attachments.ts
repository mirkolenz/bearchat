import type { FileUIPart } from "ai";

// Longest image side, larger photos are downscaled before they are sent and stored.
const maxImageSide = 2048;

export function dataURL(mediaType: string, bytes: Uint8Array) {
  return `data:${mediaType};base64,${bytes.toBase64()}`;
}

async function downscale(file: File): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
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
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  return blob.bytes();
}

/** Converts images to downscaled JPEGs and other files to UTF-8 text, rejecting binary files. */
export async function readAttachment(file: File): Promise<FileUIPart> {
  if (file.type.startsWith("image/")) {
    return {
      type: "file",
      mediaType: "image/jpeg",
      filename: file.name,
      url: dataURL("image/jpeg", await downscale(file)),
    };
  }

  return {
    type: "file",
    mediaType: "text/plain",
    filename: file.name,
    url: dataURL("text/plain", new TextEncoder().encode(await readText(file))),
  };
}

/** Reads a file as UTF-8 text, rejecting binary files, which models cannot read. */
export async function readText(file: File): Promise<string> {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await file.bytes());
  } catch {
    throw new Error(`${file.name} is not a text file`);
  }
}

/** Reads the content of a text attachment from its data URL. */
export async function attachmentText(part: FileUIPart): Promise<string> {
  return (await fetch(part.url)).text();
}
