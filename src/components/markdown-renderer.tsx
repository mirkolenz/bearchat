import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { type DiagramPlugin, Streamdown } from "streamdown";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";

import type { MarkdownProps } from "@/components/markdown";
import { isTouchScreen } from "@/lib/pointer";
import { lazy } from "@/lib/utils";

// Mermaid is the largest part of the renderer, so it is only loaded once a diagram is shown.
const loadMermaid = lazy(
  async (): Promise<DiagramPlugin> => (await import("@streamdown/mermaid")).mermaid,
);
const mermaid: DiagramPlugin = {
  name: "mermaid",
  type: "diagram",
  language: "mermaid",
  getMermaid: (config) => ({
    initialize: (options) => void loadMermaid().then((plugin) => plugin.getMermaid(options)),
    render: async (id, source) => (await loadMermaid()).getMermaid(config).render(id, source),
  }),
};

const plugins = { cjk, code, math, mermaid };
// Panning a diagram with a finger would capture the scrolling of the chat, pinch zoom still enlarges it.
const controls = { mermaid: { panZoom: !isTouchScreen() } };

// a render function rather than a component, so that the loader can call it once it is loaded
export function renderMarkdown({ children, streaming }: MarkdownProps) {
  return (
    <Streamdown plugins={plugins} controls={controls} isAnimating={streaming} animated>
      {children}
    </Streamdown>
  );
}
