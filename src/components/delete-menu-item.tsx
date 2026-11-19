import { Trash2Icon } from "lucide-react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/hooks/use-confirm";

/** Deletes on the second click, which keeps the menu open in between. */
export function DeleteMenuItem({ onDelete }: { onDelete: () => void }) {
  // the menu unmounts its items when it closes, which resets the confirmation
  const { confirming, click } = useConfirm(onDelete);

  return (
    <DropdownMenuItem variant="destructive" closeOnClick={confirming} onClick={click}>
      <Trash2Icon />
      {confirming ? "Confirm deletion" : "Delete"}
    </DropdownMenuItem>
  );
}
