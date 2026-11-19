import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";

import { isTouchScreen } from "@/lib/pointer";

const plugins = { cjk, code, math, mermaid };
// Panning a diagram with a finger would capture the scrolling of the chat, pinch zoom still enlarges it.
const controls = { mermaid: { panZoom: !isTouchScreen() } };

export function Markdown({ children, streaming }: { children: string; streaming: boolean }) {
  return (
    <Streamdown plugins={plugins} controls={controls} isAnimating={streaming} animated>
      {children}
    </Streamdown>
  );
}
