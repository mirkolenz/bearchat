import type { CallToolResult } from "@ai-sdk/mcp";
import { isDeepEqualData, type Tool } from "ai";
import { z } from "zod";

import { storeFile } from "@/lib/blobs";
import { convertFile } from "@/lib/convert";
import { jsonSchema } from "@/lib/schemas";

const textPartSchema = z.object({ type: z.literal("text"), text: z.string() });
const imagePartSchema = z.object({
  type: z.literal("image"),
  data: z.base64(),
  mimeType: z.string(),
});
// how MCP references content without embedding it, used for stored images
const resourceLinkSchema = z.object({
  type: z.literal("resource_link"),
  uri: z.string(),
  name: z.string(),
  mimeType: z.string(),
});

/** Tool results in the form of MCP's CallToolResult, with images stored and linked instead of embedded. */
export const contentResultSchema = z.object({
  content: z.array(z.discriminatedUnion("type", [textPartSchema, resourceLinkSchema])),
}) satisfies z.ZodType<Pick<CallToolResult, "content">>;

export type ContentResult = z.infer<typeof contentResultSchema>;
type ContentPart = ContentResult["content"][number];
type ModelOutput = Awaited<ReturnType<NonNullable<Tool["toModelOutput"]>>>;

// MCP results as upstream returns them, validated by the MCP client, or structured content
const mcpResultSchema = z.object({
  content: z.array(z.looseObject({ type: z.string() })),
  structuredContent: z.unknown(),
  isError: z.boolean().optional(),
});
type McpPart = z.infer<typeof mcpResultSchema>["content"][number];

/** Converts and stores an image like an attachment, so tool results hold the same images as messages. */
export async function imageLink(image: File): Promise<ContentPart> {
  const { url, mediaType, filename } = await storeFile(await convertFile(image));
  return { type: "resource_link", uri: url, name: filename ?? image.name, mimeType: mediaType };
}

// Parts other than text, such as audio or embedded resources, reach the model as JSON, as upstream sends them.
function partText(part: McpPart): string {
  return textPartSchema.safeParse(part).data?.text ?? JSON.stringify(part);
}

async function mcpPart(part: McpPart): Promise<ContentPart> {
  const image = imagePartSchema.safeParse(part);
  return image.success
    ? imageLink(
        new File([Uint8Array.fromBase64(image.data.data)], "image", { type: image.data.mimeType }),
      )
    : { type: "text", text: partText(part) };
}

/** Sends stored images as file references, which the agent resolves when it sends the request. */
export function contentModelOutput({ content }: ContentResult): ModelOutput {
  return {
    type: "content",
    value: content.map((part) =>
      part.type === "text"
        ? part
        : { type: "file", mediaType: part.mimeType, data: { type: "url", url: new URL(part.uri) } },
    ),
  };
}

/**
 * An MCP tool whose results have their images stored instead of embedded,
 * and other results as JSON text. Structured content is added as JSON text,
 * unless a text part already holds it, as the MCP spec recommends.
 */
export function mcpContentTool(tool: Tool): Tool {
  const { execute } = tool;
  return {
    ...tool,
    execute:
      execute &&
      (async (input, options): Promise<ContentResult> => {
        const output: unknown = await execute(input, options);
        const result = mcpResultSchema.safeParse(output);

        if (!result.success) {
          return { content: [{ type: "text", text: JSON.stringify(output) }] };
        }

        const { structuredContent, isError } = result.data;

        // thrown, so that the call fails and the model receives the error as such
        if (isError) {
          throw new Error(result.data.content.map(partText).join("\n"));
        }

        const content = await Promise.all(result.data.content.map(mcpPart));
        const included =
          structuredContent === undefined ||
          content.some(
            (part) =>
              part.type === "text" &&
              isDeepEqualData(jsonSchema.safeParse(part.text).data, structuredContent),
          );
        return {
          content: included
            ? content
            : [...content, { type: "text", text: JSON.stringify(structuredContent) }],
        };
      }),
    toModelOutput: ({ output }) => contentModelOutput(contentResultSchema.parse(output)),
  };
}
