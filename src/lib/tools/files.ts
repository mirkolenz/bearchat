import { tool } from "ai";
import { z } from "zod";

import { storeBlob } from "@/lib/blobs";
import { imageFormat, isImageName } from "@/lib/convert";
import { deleteFile, listFiles, readBlob, readFile, updateFile, writeFile } from "@/lib/files";
import { type ContentResult, contentModelOutput } from "@/lib/tools/content";
import { rangeSchema, sliceRange } from "@/lib/tools/range";

const nameSchema = z.object({
  name: z.string().describe("File name without directories, such as notes.md"),
});

export const fileTools = {
  list_files: tool({
    description: "List the files in the browser's private file storage with their sizes in bytes.",
    inputSchema: z.object({}),
    execute: async () => (await listFiles()).map(({ name, size }) => ({ name, size })),
  }),
  read_file: tool({
    description:
      "Read a text file from the browser's private file storage, optionally only a range of lines.",
    inputSchema: nameSchema.extend(rangeSchema("line").shape),
    execute: async ({ name, ...range }) => {
      // the line breaks stay attached, so joining restores the exact text
      const lines = (await readFile(name)).split(/(?<=\n)/);
      return { total_lines: lines.length, content: sliceRange(lines, range).join("") };
    },
  }),
  read_media: tool({
    description: "Look at an image file from the browser's private file storage.",
    inputSchema: nameSchema,
    // stored images are already converted, since only they may carry the image extension
    execute: async ({ name }): Promise<ContentResult> => {
      if (!isImageName(name)) {
        throw new Error(`${name} is not an image`);
      }

      const uri = await storeBlob(await readBlob(name));
      return { content: [{ type: "resource_link", uri, name, mimeType: imageFormat.mediaType }] };
    },
    toModelOutput: ({ output }) => contentModelOutput(output),
  }),
  write_file: tool({
    description: "Create or overwrite a text file in the browser's private file storage.",
    inputSchema: nameSchema.extend({ content: z.string().describe("Complete text of the file") }),
    execute: async ({ name, content }) => {
      await writeFile(name, content);
      return "written";
    },
  }),
  edit_file: tool({
    description:
      "Edit a text file in the browser's private file storage by exact text replacements, " +
      "applied in order. Each old_text must occur exactly once, otherwise no edit is applied.",
    inputSchema: nameSchema.extend({
      edits: z
        .array(
          z.object({
            old_text: z.string().min(1).describe("Exact text to replace, including whitespace"),
            new_text: z.string().describe("Text to put in its place"),
          }),
        )
        .min(1)
        .describe("Replacements applied in order, each to the result of the previous one"),
    }),
    execute: async ({ name, edits }) => {
      await updateFile(name, (text) =>
        edits.reduce((content, { old_text: search, new_text: replacement }) => {
          const index = content.indexOf(search);

          if (index === -1) {
            throw new Error(`Not found: ${search}`);
          }

          if (content.includes(search, index + 1)) {
            throw new Error(`Found more than once, add context to make it unique: ${search}`);
          }

          return content.slice(0, index) + replacement + content.slice(index + search.length);
        }, text),
      );
      return "edited";
    },
  }),
  delete_file: tool({
    description: "Delete a file from the browser's private file storage.",
    inputSchema: nameSchema,
    execute: async ({ name }) => {
      await deleteFile(name);
      return "deleted";
    },
  }),
};
