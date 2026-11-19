import { z } from "zod";

/** A 1-based inclusive range of lines or messages, both ends optional. */
export function rangeSchema(unit: string) {
  return z.object({
    start: z.int().min(1).optional().describe(`First ${unit} to return, 1-based, default 1`),
    end: z.int().min(1).optional().describe(`Last ${unit} to return, inclusive, default the last`),
  });
}

export function sliceRange<T>(items: T[], { start = 1, end }: z.infer<ReturnType<typeof rangeSchema>>) {
  return items.slice(start - 1, end);
}
