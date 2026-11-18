import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";

const plugins = { cjk, code, math, mermaid };

export function Markdown({ children, streaming }: { children: string; streaming: boolean }) {
  return (
    <Streamdown plugins={plugins} isAnimating={streaming} animated>
      {children}
    </Streamdown>
  );
}
