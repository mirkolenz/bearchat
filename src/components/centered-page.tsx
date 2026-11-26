import type { ReactNode } from "react";

import { Logo } from "@/components/logo";

/** A page with a branded title and its content centered, which scrolls from the top once the content is taller than the screen. */
export function CenteredPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-(--viewport-height) flex-col items-center p-safe-6">
      <div className="my-auto flex w-full max-w-md flex-col gap-7">
        <h1 className="flex items-center gap-3 text-2xl font-semibold">
          <Logo className="size-10" />
          {title}
        </h1>
        {children}
      </div>
    </main>
  );
}
