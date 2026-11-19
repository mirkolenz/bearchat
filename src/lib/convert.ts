// One conversion for everything the model reads from files, be it attachments, MCP resources or stored files:
// images become downscaled JPEGs, documents Markdown, text stays text, and anything else is rejected.
import { decodeText, errorMessage, lazy } from "@/lib/utils";

// Longest image side, larger photos are downscaled before they are sent and stored.
const maxImageSide = 2048;

// anydoc is loaded on first use, since its WebAssembly build is large.
const loadAnydoc = lazy(async () => {
  const module = await import("@firecrawl/anydoc-wasm");
  await module.default();
  return module;
});

export function dataURL(mediaType: string, bytes: Uint8Array) {
  return `data:${mediaType};base64,${bytes.toBase64()}`;
}

/** The format of all images, attached or stored, whose names carry its extension. */
export const imageFormat = { mediaType: "image/jpeg", extension: "jpg" } as const;

/** Replaces the extension, so that the name matches the converted content. */
function withExtension(name: string, extension: string): string {
  const dot = name.lastIndexOf(".");
  // a dot that starts the name or one of the directories of a URI begins no extension
  const stem = dot > name.lastIndexOf("/") + 1 ? name.slice(0, dot) : name;
  return `${stem}.${extension}`;
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

  const { formatFromBytes, toMarkdownBytes } = await loadAnydoc();
  const format = formatFromBytes(bytes);

  if (format === undefined) {
    throw new Error(`${file.name} is not an image, document or text file`);
  }

  try {
    return textFile(withExtension(file.name, "md"), toMarkdownBytes(bytes, format));
  } catch (error) {
    throw new Error(`${file.name} could not be converted: ${errorMessage(error)}`);
  }
}
