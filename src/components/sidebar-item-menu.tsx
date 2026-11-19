import { EllipsisIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuAction, useSidebar } from "@/components/ui/sidebar";

/** The actions of a sidebar entry, revealed on hover with a mouse and always shown on touch screens. */
export function SidebarItemMenu({ label, children }: { label: string; children: ReactNode }) {
  const { isMobile } = useSidebar();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuAction
            aria-label={label}
            className="peer-data-active/menu-button:text-sidebar-accent-foreground pointer-fine:opacity-0 pointer-fine:group-focus-within/menu-item:opacity-100 pointer-fine:group-hover/menu-item:opacity-100 pointer-fine:aria-expanded:opacity-100"
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      {/* the overlaid sidebar spans most of the screen, which leaves no room to its right */}
      <DropdownMenuContent side={isMobile ? "bottom" : "right"} align={isMobile ? "end" : "start"}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
