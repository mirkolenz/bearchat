import { loadMarkdown } from "@/components/markdown";
import { resumeSession, type Session } from "@/lib/connection";
import { startRouting } from "@/lib/route";
import { watchThreads } from "@/lib/threads";

export interface Startup {
  session?: Session;
  error?: string;
}

/** Loads everything the first render needs in parallel, so the app renders once without fallbacks. */
export async function start(): Promise<Startup> {
  // Without the renderer, Markdown is shown as plain text, which is preferable to failing to start.
  const markdown = loadMarkdown().catch(() => undefined);
  const [resumed, page] = await Promise.all([
    resumeSession(),
    startRouting(),
    watchThreads(),
  ]);

  // only a chat with messages waits for the renderer
  if (page.thread.messages.length > 0) {
    await markdown;
  }

  return resumed;
}
