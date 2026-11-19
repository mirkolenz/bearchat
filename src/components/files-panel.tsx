import { DownloadIcon, FileTextIcon, FolderOpenIcon, ImageIcon, UploadIcon } from "lucide-react";
import { type DragEvent, useEffect, useRef, useState } from "react";

import { convertFiles } from "@/components/convert-files";
import { DeleteMenuItem } from "@/components/delete-menu-item";
import { DialogBody, DialogPanel } from "@/components/dialog-panel";
import { SidebarItemMenu } from "@/components/sidebar-item-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar";
import { dataURL, imageFormat, isImageName } from "@/lib/convert";
import { addFile, deleteFile, watchFiles } from "@/lib/files";
import { downloadFile, formatTime } from "@/lib/utils";

const sizeFormat = new Intl.NumberFormat(undefined, {
  notation: "compact",
  style: "unit",
  unit: "byte",
  unitDisplay: "narrow",
});

/** The stored files, refreshed whenever the app or a tool changes them. */
function useFiles(): File[] | undefined {
  const [files, setFiles] = useState<File[]>();

  useEffect(() => watchFiles(setFiles), []);

  return files;
}

async function upload(selected: Iterable<File>) {
  for (const file of await convertFiles(selected)) {
    await addFile(file.name, file);
  }
}

/** Files in the browser's private storage, converted like attachments, which the file tools and Python can read. */
export function FilesPanel() {
  const files = useFiles();
  const input = useRef<HTMLInputElement>(null);
  const [previewing, setPreviewing] = useState<File>();

  const drop = (event: DragEvent) => {
    event.preventDefault();
    // the chat attaches files dropped anywhere else
    event.stopPropagation();
    void upload(event.dataTransfer.files);
  };

  return (
    <>
      <SidebarHeader>
        <Button variant="outline" onClick={() => input.current?.click()}>
          <UploadIcon />
          Upload files
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
                Upload or drop images, documents or text files. Files written by the model also
                appear here.
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
                        {isImageName(file.name) ? <ImageIcon /> : <FileTextIcon />}
                        <span className="truncate">{file.name}</span>
                      </SidebarMenuButton>
                      <SidebarItemMenu label="File actions">
                        <DropdownMenuItem onClick={() => downloadFile(file.name, file)}>
                          <DownloadIcon />
                          Download
                        </DropdownMenuItem>
                        <DeleteMenuItem onDelete={() => void deleteFile(file.name)} />
                      </SidebarItemMenu>
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

// Longer texts are cut off in the preview, which would otherwise render them in full.
const maxPreviewLength = 100_000;

function FilePreview({ file, onClose }: { file: File; onClose: () => void }) {
  const image = isImageName(file.name);
  // the text, or the data URL of an image, which is small since images are stored downscaled
  const [content, setContent] = useState<string>();

  useEffect(() => {
    const read = image
      ? file.bytes().then((bytes) => dataURL(imageFormat.mediaType, bytes))
      : file
          .slice(0, maxPreviewLength)
          .text()
          .then((text) => (file.size > maxPreviewLength ? `${text}…` : text));
    void read.then(setContent);
  }, [file, image]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{file.name}</DialogTitle>
          <DialogDescription>
            {sizeFormat.format(file.size)} · {formatTime(file.lastModified)}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {image ? (
            <img src={content} alt={file.name} className="min-h-0 rounded-md object-contain" />
          ) : (
            <pre className="rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
              {content}
            </pre>
          )}
        </DialogBody>
      </DialogPanel>
    </Dialog>
  );
}
