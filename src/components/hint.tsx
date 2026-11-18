import type { ReactElement } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Shows a label for an icon control, which also names it for assistive technology. */
export function Hint({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger aria-label={label} render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
