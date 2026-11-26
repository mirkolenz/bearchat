import {
  DownloadIcon,
  FileDownIcon,
  GhostIcon,
  LogOutIcon,
  PencilIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";
import { type FormEvent, memo, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { DeleteMenuItem } from "@/components/delete-menu-item";
import { DialogBody, DialogPanel } from "@/components/dialog-panel";
import { FilesPanel } from "@/components/files-panel";
import { Logo } from "@/components/logo";
import { SelectableGroupLabel, SelectionItem, useSelection } from "@/components/selection";
import { SettingsDialog } from "@/components/settings-dialog";
import { SidebarItemMenu } from "@/components/sidebar-item-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { toMarkdown } from "@/lib/chat";
import { config } from "@/lib/config";
import { signOut } from "@/lib/connection";
import { deleteThreads, downloadBackup, loadThread, updateThread, useThreads } from "@/lib/threads";
import { openTemporaryThread, openThread, useTarget } from "@/lib/route";
import { downloadFile } from "@/lib/utils";

// shortcuts use ⌘ on Apple devices and Ctrl elsewhere
const modifier = navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl";

export function AppSidebar({ canSignOut }: { canSignOut: boolean }) {
  // loaded before the first render, so the list never shows placeholders on startup
  const threads = useThreads();
  const target = useTarget();
  const { setOpenMobile } = useSidebar();
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"chats" | "files">("chats");
  const matches = threads.filter((thread) =>
    thread.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const selection = useSelection(matches, (thread) => thread.id);

  // the overlaid sidebar gives way to the opened chat, however it was opened
  useEffect(() => setOpenMobile(false), [target, setOpenMobile]);

  // ⇧⌘O starts a new chat and ⌘K searches chats, with Ctrl instead of ⌘ elsewhere
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (event.shiftKey && key === "o") {
        event.preventDefault();
        openThread();
      } else if (!event.shiftKey && key === "k") {
        event.preventDefault();
        // the search field only exists once the chats tab is shown
        flushSync(() => setTab("chats"));
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  return (
    <Sidebar>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value === "files" ? "files" : "chats")}
        className="min-h-0 flex-1 gap-0 pt-safe-0 pl-safe-0"
      >
        <SidebarHeader>
          <div className="flex h-8 items-center gap-2 px-2 font-semibold">
            <Logo className="size-6" />
            {config.title}
          </div>
          <TabsList className="w-full">
            <TabsTrigger value="chats">Chats</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
          </TabsList>
        </SidebarHeader>
        <TabsContent value="chats" className="flex min-h-0 flex-col">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => openThread()}>
                  <SquarePenIcon />
                  New chat
                </SidebarMenuButton>
                {/* shortcuts need a keyboard, which touch screens usually lack */}
                <SidebarMenuBadge className="pointer-coarse:hidden">
                  <KbdGroup>
                    <Kbd>⇧</Kbd>
                    <Kbd>{modifier}</Kbd>
                    <Kbd>O</Kbd>
                  </KbdGroup>
                </SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={openTemporaryThread}>
                  <GhostIcon />
                  Temporary chat
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <InputGroup className="h-8">
              <InputGroupInput
                ref={search}
                type="search"
                aria-label="Search chats"
                placeholder="Search chats"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <InputGroupAddon align="inline-end" className="pointer-coarse:hidden">
                <KbdGroup>
                  <Kbd>{modifier}</Kbd>
                  <Kbd>K</Kbd>
                </KbdGroup>
              </InputGroupAddon>
            </InputGroup>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SelectableGroupLabel
                label="Chats"
                selection={selection}
                action={{
                  label: "Export",
                  icon: <DownloadIcon />,
                  run: (selected) => void downloadBackup(selected.map((thread) => thread.id)),
                }}
                onDelete={(selected) => void deleteThreads(selected.map((thread) => thread.id))}
              />
              <SidebarMenu>
                {matches.map((thread) =>
                  selection.selecting ? (
                    <SelectionItem
                      key={thread.id}
                      selection={selection}
                      id={thread.id}
                      label={thread.title}
                    />
                  ) : (
                    <ThreadItem
                      key={thread.id}
                      id={thread.id}
                      title={thread.title}
                      active={thread.id === target?.id}
                    />
                  ),
                )}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
        </TabsContent>
        <TabsContent value="files" className="flex min-h-0 flex-col">
          <FilesPanel />
        </TabsContent>
      </Tabs>
      <SidebarFooter className="pb-safe-2 pl-safe-2">
        <SettingsMenu canSignOut={canSignOut} />
      </SidebarFooter>
    </Sidebar>
  );
}

interface ThreadItemProps {
  id: string;
  title: string;
  active: boolean;
}

// Memoized with plain props, so that a changed chat, a search or a navigation only re-renders the affected rows.
const ThreadItem = memo(function ThreadItem({ id, title, active }: ThreadItemProps) {
  const [renaming, setRenaming] = useState(false);

  const exportMarkdown = async () => {
    const { messages } = await loadThread(id);
    downloadFile(`${title}.md`, toMarkdown(messages), "text/markdown");
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} onClick={() => openThread(id)}>
        <span className="truncate">{title}</span>
      </SidebarMenuButton>
      <SidebarItemMenu label="Chat actions">
        <DropdownMenuItem onClick={() => setRenaming(true)}>
          <PencilIcon />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void exportMarkdown()}>
          <FileDownIcon />
          Export as Markdown
        </DropdownMenuItem>
        <DeleteMenuItem onDelete={() => void deleteThreads([id])} />
      </SidebarItemMenu>
      {renaming && <RenameDialog id={id} title={title} onClose={() => setRenaming(false)} />}
    </SidebarMenuItem>
  );
});

interface RenameDialogProps {
  id: string;
  title: string;
  onClose: () => void;
}

function RenameDialog({ id, title: initial, onClose }: RenameDialogProps) {
  const [title, setTitle] = useState(initial);

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (title.trim()) {
      void updateThread(id, { title: title.trim() });
    }

    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Input
              aria-label="Title"
              enterKeyHint="done"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </DialogBody>
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogPanel>
    </Dialog>
  );
}

function SettingsMenu({ canSignOut }: { canSignOut: boolean }) {
  const [editing, setEditing] = useState(false);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton onClick={() => setEditing(true)}>
          <SettingsIcon />
          Settings
        </SidebarMenuButton>
        {editing && <SettingsDialog onClose={() => setEditing(false)} />}
      </SidebarMenuItem>
      {canSignOut && (
        <SidebarMenuItem>
          {/* a fresh start, so that nothing of the session stays in memory, such as the shown chat */}
          <SidebarMenuButton onClick={() => void signOut().then(() => location.reload())}>
            <LogOutIcon />
            Sign out
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}
    </SidebarMenu>
  );
}
