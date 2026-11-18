import { z } from "zod";

export { cn } from "cn";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const compactNumber = new Intl.NumberFormat(undefined, { notation: "compact" });

export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Parses a JSON string, so that it can be piped into a schema of the expected shape. */
export const jsonSchema = z.string().transform((text, context): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    context.addIssue({ code: "custom", message: "Invalid JSON" });
    return z.NEVER;
  }
});
