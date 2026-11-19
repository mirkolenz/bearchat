import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  type LucideIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  toast,
} from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const icons: Record<string, { icon: LucideIcon; className?: string }> = {
  success: { icon: CircleCheckIcon },
  info: { icon: InfoIcon },
  warning: { icon: TriangleAlertIcon },
  error: { icon: OctagonXIcon, className: "text-destructive" },
  loading: { icon: Loader2Icon, className: "animate-spin" },
};

// The generated toasts stack upwards from the bottom, these stack downwards from the top,
// following the top-center example of Base UI.
const topStacking = cn(
  "top-0 bottom-auto origin-top after:top-auto after:bottom-full",
  "[--offset-y:calc(var(--toast-offset-y)+(var(--toast-index)*var(--gap))+var(--toast-swipe-movement-y))]",
  "[transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+(var(--toast-index)*var(--peek))+(var(--shrink)*var(--height))))_scale(var(--scale))]",
  "data-starting-style:[transform:translateY(-150%)]",
  "[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(-150%)]",
);

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();

  return toasts.map((item) => {
    const icon = item.type === undefined ? undefined : icons[item.type];

    return (
      <Toast key={item.id} toast={item} swipeDirection="up" className={topStacking}>
        <ToastContent>
          {icon && (
            <icon.icon aria-hidden="true" className={cn("size-4 shrink-0", icon.className)} />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <ToastTitle />
            {/* errors stay selectable, so they can be copied */}
            <ToastDescription className="select-text wrap-anywhere" />
          </div>
          <ToastAction />
          <ToastClose />
        </ToastContent>
      </Toast>
    );
  });
}

/** Toasts at the top center below the safe area, where they cover neither the composer nor dialogs. */
export function Toaster({ children }: { children: ReactNode }) {
  return (
    <ToastProvider toastManager={toast}>
      {children}
      <ToastPortal>
        <ToastViewport className="top-safe-4 bottom-auto z-60 sm:inset-x-4 sm:mx-auto sm:w-auto">
          <ToastList />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}
