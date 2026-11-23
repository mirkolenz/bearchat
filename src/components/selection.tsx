import { ListChecksIcon, SquareCheckIcon, SquareIcon, Trash2Icon, XIcon } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";

import { Hint } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useConfirm } from "@/hooks/use-confirm";

/** The items selected in a list for bulk actions, which is only selectable after start is called. */
export function useSelection<T>(items: readonly T[], keyOf: (item: T) => string) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>();

  const toggle = useCallback(
    (key: string) =>
      setChosen((previous) => {
        const next = new Set(previous);

        if (!next.delete(key)) {
          next.add(key);
        }

        return next;
      }),
    [],
  );

  return {
    // listed items only, so that actions never touch entries deleted meanwhile or hidden by a search
    selected: chosen ? items.filter((item) => chosen.has(keyOf(item))) : [],
    selecting: chosen !== undefined,
    total: items.length,
    isSelected: (key: string) => chosen?.has(key) ?? false,
    toggle,
    start: () => setChosen(new Set()),
    stop: () => setChosen(undefined),
    setAll: (all: boolean) => setChosen(new Set(all ? items.map(keyOf) : [])),
  };
}

export type ListSelection<T> = ReturnType<typeof useSelection<T>>;

interface SelectableGroupLabelProps<T> {
  label: string;
  selection: ListSelection<T>;
  // the action besides deleting, such as downloading
  action: { label: string; icon: ReactNode; run: (items: T[]) => void };
  onDelete: (items: T[]) => void;
}

/** The label of a sidebar group, replaced by the bulk actions while selecting. */
export function SelectableGroupLabel<T>({
  label,
  selection,
  action,
  onDelete,
}: SelectableGroupLabelProps<T>) {
  const { selected, total } = selection;
  // a confirmation only covers the entries selected when it was asked for
  const deletion = useConfirm(() => {
    onDelete(selected);
    selection.stop();
  }, selected);

  if (!selection.selecting) {
    return (
      <>
        <SidebarGroupLabel>{label}</SidebarGroupLabel>
        {total > 0 && (
          <Hint label="Select">
            <SidebarGroupAction onClick={selection.start}>
              <ListChecksIcon />
            </SidebarGroupAction>
          </Hint>
        )}
      </>
    );
  }

  return (
    <div className="sticky top-0 z-10 flex h-8 shrink-0 items-center gap-0.5 bg-sidebar pl-2">
      <Checkbox
        aria-label="Select all"
        disabled={total === 0}
        checked={total > 0 && selected.length === total}
        onCheckedChange={selection.setAll}
      />
      <SidebarGroupLabel className="flex-1 truncate px-2">
        {selected.length} selected
      </SidebarGroupLabel>
      <Hint label={action.label}>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={selected.length === 0}
          onClick={() => action.run(selected)}
        >
          {action.icon}
        </Button>
      </Hint>
      {deletion.confirming ? (
        <Button variant="destructive" size="sm" onClick={deletion.click}>
          Confirm
        </Button>
      ) : (
        <Hint label="Delete">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={selected.length === 0}
            onClick={deletion.click}
          >
            <Trash2Icon />
          </Button>
        </Hint>
      )}
      <Hint label="Done">
        <Button variant="ghost" size="icon-sm" onClick={selection.stop}>
          <XIcon />
        </Button>
      </Hint>
    </div>
  );
}

interface SelectionItemProps<T> {
  selection: ListSelection<T>;
  id: string;
  label: string;
}

/** An entry while selecting, which toggles its selection instead of opening it. */
export function SelectionItem<T>({ selection, id, label }: SelectionItemProps<T>) {
  const selected = selection.isSelected(id);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={selected}
        aria-pressed={selected}
        onClick={() => selection.toggle(id)}
      >
        {selected ? <SquareCheckIcon /> : <SquareIcon />}
        <span className="truncate">{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
