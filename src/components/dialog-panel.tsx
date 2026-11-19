import type { ComponentProps } from "react";

import { DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Dialog content that fills the screen on phones and is a centered card elsewhere.
 * The header and footer stay in place while a DialogBody between them scrolls.
 * Forms inside should use `contents`, so their fields take part in this layout.
 */
export function DialogPanel({ className, ...props }: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      className={cn(
        "flex max-h-[calc(var(--viewport-height)-2rem)] flex-col wrap-anywhere",
        // room for the close button
        "**:data-[slot=dialog-header]:pr-10",
        "max-sm:top-0 max-sm:left-0 max-sm:h-(--viewport-height) max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none",
        "max-sm:p-safe-6 max-sm:*:data-[slot=dialog-close]:top-safe-4 max-sm:*:data-[slot=dialog-close]:right-safe-4",
        className,
      )}
      {...props}
    />
  );
}

/** The scrolling part of a DialogPanel, which reaches to its edges so that focus rings are not clipped. */
export function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "-mx-6 -my-1 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-6 py-1",
        className,
      )}
      {...props}
    />
  );
}
