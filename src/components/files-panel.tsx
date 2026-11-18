import { DownloadIcon, EllipsisIcon, FileTextIcon, FolderOpenIcon, UploadIcon } from "lucide-react";
import { type DragEvent, useEffect, useRef, useState } from "react";

import { DeleteMenuItem } from "@/components/delete-menu-item";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar";
import { toast } from "@/components/ui/toast";
import { readText } from "@/lib/attachments";
import { deleteFile, listFiles, subscribeFiles, writeFile } from "@/lib/files";
import { downloadFile, errorMessage } from "@/lib/utils";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const sizeFormat = new Intl.NumberFormat(undefined, {
  notation: "compact",
  style: "unit",
  unit: "byte",
  unitDisplay: "narrow",
});

/** The stored files, refreshed whenever the app or a tool changes them. */
function useFiles(): File[] | undefined {
  const [files, setFiles] = useState<File[]>();

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const next = await listFiles();

      if (mounted) {
        setFiles(next);
      }
    };
    void load();
    const unsubscribe = subscribeFiles(() => void load());
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return files;
}

async function upload(selected: Iterable<File>) {
  for (const file of selected) {
    try {
      await writeFile(file.name, await readText(file));
    } catch (error) {
      toast.add({
        type: "error",
        title: `${file.name} was not uploaded`,
        description: errorMessage(error),
      });
    }
  }
}

async function download(file: File) {
  downloadFile(file.name, await file.text(), "text/plain");
}

/** Text files in the browser's private storage, which the file tools and Python can read. */
export function FilesPanel() {
  const files = useFiles();
  const input = useRef<HTMLInputElement>(null);
  const [previewing, setPreviewing] = useState<File>();

  const drop = (event: DragEvent) => {
    event.preventDefault();
    void upload(event.dataTransfer.files);
  };

  return (
    <>
      <SidebarHeader>
        <Button variant="outline" onClick={() => input.current?.click()}>
          <UploadIcon />
          Upload text files
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            void upload(event.target.files ?? []);
            event.target.value = "";
          }}
        />
      </SidebarHeader>
      <SidebarContent onDragOver={(event) => event.preventDefault()} onDrop={drop}>
        {files?.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpenIcon />
              </EmptyMedia>
              <EmptyTitle>No files</EmptyTitle>
              <EmptyDescription>
                Drop text files here. Files written by the model also appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <SidebarGroup>
            <SidebarMenu>
              {files === undefined
                ? Array.from({ length: 3 }, (_, index) => (
                    <SidebarMenuItem key={index}>
                      <SidebarMenuSkeleton />
                    </SidebarMenuItem>
                  ))
                : files.map((file) => (
                    <SidebarMenuItem key={file.name}>
                      <SidebarMenuButton onClick={() => setPreviewing(file)}>
                        <FileTextIcon />
                        <span className="truncate">{file.name}</span>
                      </SidebarMenuButton>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<SidebarMenuAction showOnHover aria-label="File actions" />}
                        >
                          <EllipsisIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start">
                          <DropdownMenuItem onClick={() => void download(file)}>
                            <DownloadIcon />
                            Download
                          </DropdownMenuItem>
                          <DeleteMenuItem onDelete={() => void deleteFile(file.name)} />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </SidebarMenuItem>
                  ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      {previewing && <FilePreview file={previewing} onClose={() => setPreviewing(undefined)} />}
    </>
  );
}

function FilePreview({ file, onClose }: { file: File; onClose: () => void }) {
  const [text, setText] = useState<string>();

  useEffect(() => {
    void file.text().then(setText);
  }, [file]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{file.name}</DialogTitle>
          <DialogDescription>
            {sizeFormat.format(file.size)} · {dateFormat.format(file.lastModified)}
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[60svh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
          {text}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
