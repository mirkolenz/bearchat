import type { renderMarkdown } from "@/components/markdown-renderer";
import { createStore } from "@/lib/store";
import { lazy } from "@/lib/utils";

export interface MarkdownProps {
  children: string;
  streaming: boolean;
}

const renderer = createStore<typeof renderMarkdown | undefined>(undefined);

/** Loads the Markdown renderer, which is large, so that the app can render before it is downloaded. */
export const loadMarkdown = lazy(async () => {
  renderer.set((await import("@/components/markdown-renderer")).renderMarkdown);
});

/** Markdown, shown as plain text until the renderer is loaded. */
export function Markdown(props: MarkdownProps) {
  const render = renderer.useValue();
  return render === undefined ? (
    <div className="whitespace-pre-wrap">{props.children}</div>
  ) : (
    render(props)
  );
}
