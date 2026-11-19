import type { ReactNode } from "react";

/** A page with its content centered, which scrolls from the top once the content is taller than the screen. */
export function CenteredPage({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-(--viewport-height) flex-col items-center p-safe-6">
      <div className="my-auto w-full max-w-md">{children}</div>
    </main>
  );
}
