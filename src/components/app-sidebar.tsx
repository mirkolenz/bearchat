import { useLiveQuery } from "dexie-react-hooks";
import {
  EllipsisIcon,
  FileDownIcon,
  GhostIcon,
  LogOutIcon,
  PencilIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { DeleteMenuItem } from "@/components/delete-menu-item";
import { FilesPanel } from "@/components/files-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { toMarkdown } from "@/lib/chat";
import { config } from "@/lib/config";
import type { Thread } from "@/lib/db";
import { deleteThread, listThreads, loadThread, updateThread } from "@/lib/threads";
import { openTemporaryThread, openThread } from "@/lib/route";
import { downloadFile } from "@/lib/utils";

// shortcuts use ⌘ on Apple devices and Ctrl elsewhere
const modifier = navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl";

interface AppSidebarProps {
  activeId: string;
  // loaded before the first render, so the list never shows placeholders on startup
  initialThreads: Thread[];
  onSignOut: () => void;
}

export function AppSidebar({ activeId, initialThreads, onSignOut }: AppSidebarProps) {
  const threads = useLiveQuery(listThreads, [], initialThreads);
  const { setOpenMobile } = useSidebar();
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"chats" | "files">("chats");
  const matches = threads.filter((thread) =>
    thread.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const navigate = (open: () => void) => {
    open();
    setOpenMobile(false);
  };

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
        className="min-h-0 flex-1 gap-0"
      >
        <SidebarHeader>
          <TabsList className="w-full">
            <TabsTrigger value="chats">Chats</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
          </TabsList>
        </SidebarHeader>
        <TabsContent value="chats" className="flex min-h-0 flex-col">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => navigate(() => openThread())}>
                  <SquarePenIcon />
                  New chat
                </SidebarMenuButton>
                <SidebarMenuBadge>
                  <KbdGroup>
                    <Kbd>⇧</Kbd>
                    <Kbd>{modifier}</Kbd>
                    <Kbd>O</Kbd>
                  </KbdGroup>
                </SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => navigate(openTemporaryThread)}>
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
              <InputGroupAddon align="inline-end">
                <KbdGroup>
                  <Kbd>{modifier}</Kbd>
                  <Kbd>K</Kbd>
                </KbdGroup>
              </InputGroupAddon>
            </InputGroup>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>{config.title}</SidebarGroupLabel>
              <SidebarMenu>
                {matches.map((thread) => (
                  <ThreadItem
                    key={thread.id}
                    thread={thread}
                    active={thread.id === activeId}
                    onOpen={() => navigate(() => openThread(thread.id))}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
        </TabsContent>
        <TabsContent value="files" className="flex min-h-0 flex-col">
          <FilesPanel />
        </TabsContent>
      </Tabs>
      <SidebarFooter>
        <SettingsMenu onSignOut={onSignOut} />
      </SidebarFooter>
    </Sidebar>
  );
}

interface ThreadItemProps {
  thread: Thread;
  active: boolean;
  onOpen: () => void;
}

function ThreadItem({ thread, active, onOpen }: ThreadItemProps) {
  const [renaming, setRenaming] = useState(false);

  const remove = () => {
    void deleteThread(thread.id);

    if (active) {
      openThread();
    }
  };

  const exportMarkdown = async () => {
    const { messages } = await loadThread(thread.id);
    downloadFile(`${thread.title}.md`, toMarkdown(messages), "text/markdown");
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} onClick={onOpen}>
        <span className="truncate">{thread.title}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger render={<SidebarMenuAction showOnHover aria-label="Chat actions" />}>
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void exportMarkdown()}>
            <FileDownIcon />
            Export as Markdown
          </DropdownMenuItem>
          <DeleteMenuItem onDelete={remove} />
        </DropdownMenuContent>
      </DropdownMenu>
      {renaming && <RenameDialog thread={thread} onClose={() => setRenaming(false)} />}
    </SidebarMenuItem>
  );
}

function RenameDialog({ thread, onClose }: { thread: Thread; onClose: () => void }) {
  const [title, setTitle] = useState(thread.title);

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (title.trim()) {
      void updateThread(thread.id, { title: title.trim() });
    }

    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <Input
            aria-label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SettingsMenu({ onSignOut }: { onSignOut: () => void }) {
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
      <SidebarMenuItem>
        <SidebarMenuButton onClick={onSignOut}>
          <LogOutIcon />
          Sign out
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
