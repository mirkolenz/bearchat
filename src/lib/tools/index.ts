import type { ToolSet } from "ai";

import { type ServerErrorHandler, serverTools } from "@/lib/mcp";
import type { Settings } from "@/lib/settings";
import { createChatTools } from "@/lib/tools/chats";
import { fileTools } from "@/lib/tools/files";
import { createPythonTools } from "@/lib/tools/python";

/** Collects the enabled tools, the names of those that run without approval, and the servers' instructions. */
export async function createTools(
  settings: Settings,
  threadId: string,
  onServerError: ServerErrorHandler,
) {
  // Built-in tools only read or touch the app's own browser storage, so they always run.
  const builtIn: ToolSet = {
    ...(settings.fileTools ? fileTools : {}),
    ...(settings.chatTools ? createChatTools(threadId) : {}),
    ...(settings.pythonTool ? createPythonTools(settings.fileTools, threadId) : {}),
  };
  const servers = await serverTools(settings, onServerError);
  return {
    tools: Object.assign(
      {},
      builtIn,
      Object.fromEntries(servers.tools.map((tool) => [tool.name, tool.value])),
    ),
    approved: new Set([
      ...Object.keys(builtIn),
      ...servers.tools.filter((tool) => tool.approved).map((tool) => tool.name),
    ]),
    instructions: servers.instructions,
  };
}
