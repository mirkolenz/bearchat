import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/** Deletes on the second click, which keeps the menu open in between. */
export function DeleteMenuItem({ onDelete }: { onDelete: () => void }) {
  // the menu unmounts its items when it closes, which resets the confirmation
  const [confirming, setConfirming] = useState(false);

  return (
    <DropdownMenuItem
      variant="destructive"
      closeOnClick={confirming}
      onClick={() => (confirming ? onDelete() : setConfirming(true))}
    >
      <Trash2Icon />
      {confirming ? "Click again to delete" : "Delete"}
    </DropdownMenuItem>
  );
}
