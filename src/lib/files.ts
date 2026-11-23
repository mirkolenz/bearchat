// The browser's origin private file system, one flat directory shared by all chats.
// It holds text and the images of uploads, which pass the same conversion as attachments.
// Names carry the type, since the storage has none, so writes keep the image extension for images.
import { imageFormat, isImageName, splitExtension } from "@/lib/convert";
import { decodeText, exclusive, namedError } from "@/lib/utils";

declare global {
  // part of the File System standard and shipped by all major browsers, but not yet in TypeScript's DOM types
  interface FileSystemFileHandle {
    move(name: string): Promise<void>;
  }
}

const root = () => navigator.storage.getDirectory();
const changes = new EventTarget();

function changed() {
  changes.dispatchEvent(new Event("change"));
}

/**
 * Calls the listener with the files now and after every change, until the returned function is called.
 * Changes during a listing are coalesced into one more listing, so that bursts such as uploads
 * list the files only twice, and an older listing never replaces a newer one.
 */
export function watchFiles(listener: (files: File[]) => void): () => void {
  let active = true;
  let loading = false;
  let stale = false;

  const load = async () => {
    if (loading) {
      stale = true;
      return;
    }

    loading = true;

    try {
      do {
        stale = false;
        const files = await listFiles();

        if (active) {
          listener(files);
        }
      } while (stale && active);
    } finally {
      loading = false;
    }
  };

  const handle = () => void load();
  changes.addEventListener("change", handle);
  handle();
  return () => {
    active = false;
    changes.removeEventListener("change", handle);
  };
}

/** Validates a file name, accepting the absolute paths that Python passes. */
function fileName(path: string): string {
  const name = path.replace(/^\//, "");

  if (name === "" || name.includes("/")) {
    throw new Error(`Files have plain names without directories: ${path}`);
  }

  return name;
}

/** Opens a file, raising the FileNotFoundError that Python expects for missing ones. */
async function fileHandle(path: string): Promise<FileSystemFileHandle> {
  const name = fileName(path);

  try {
    return await (await root()).getFileHandle(name);
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      throw namedError("FileNotFoundError", `No such file: ${name}`);
    }

    throw error;
  }
}

export async function listNames(): Promise<string[]> {
  return (await Array.fromAsync((await root()).keys())).toSorted();
}

/** The files with their metadata, which only the files panel needs. */
export async function listFiles(): Promise<File[]> {
  const handles = await Array.fromAsync((await root()).values());
  const files = await Promise.all(
    handles.flatMap((handle) => (handle.kind === "file" ? [handle.getFile()] : [])),
  );
  return files.toSorted((a, b) => a.name.localeCompare(b.name));
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await fileHandle(path);
    return true;
  } catch {
    return false;
  }
}

export async function readBlob(path: string): Promise<File> {
  return (await fileHandle(path)).getFile();
}

export async function readFile(path: string): Promise<string> {
  const file = await readBlob(path);
  const text = decodeText(await file.bytes());

  if (text === undefined) {
    throw new Error(`${file.name} is not a text file`);
  }

  return text;
}

// Changes hold one lock, so that an update cannot interleave with other changes, also from other tabs.
const changing = <T>(task: () => Promise<T>) => exclusive("files", task);

function checkImageName(name: string, image: boolean) {
  if (isImageName(name) !== image) {
    throw new Error(`Only images have the .${imageFormat.extension} extension: ${name}`);
  }
}

async function write(path: string, content: string | Blob, append = false): Promise<void> {
  const name = fileName(path);
  checkImageName(name, content instanceof Blob && content.type === imageFormat.mediaType);
  const handle = await (await root()).getFileHandle(name, { create: true });
  const writable = await handle.createWritable({ keepExistingData: append });

  if (append) {
    await writable.seek((await handle.getFile()).size);
  }

  await writable.write(content);
  await writable.close();
  changed();
}

export function writeFile(path: string, content: string | Blob): Promise<void> {
  return changing(() => write(path, content));
}

/** Appends text to the end of a file in place, creating the file if it is missing. */
export function appendFile(path: string, text: string): Promise<void> {
  return changing(() => write(path, text, true));
}

/** Writes a file without replacing another one, numbering the name if it is taken, such as report-2.md. */
export function addFile(path: string, content: Blob): Promise<void> {
  return changing(async () => {
    const [stem, extension] = splitExtension(fileName(path));
    let name = `${stem}${extension}`;

    for (let number = 2; await fileExists(name); number++) {
      name = `${stem}-${number}${extension}`;
    }

    await write(name, content);
  });
}

/** Replaces the text of a file with the result of the update, without changes in between. */
export function updateFile(path: string, update: (text: string) => string): Promise<void> {
  return changing(async () => write(path, update(await readFile(path))));
}

/** Deletes files, none of them if one is missing. */
export function deleteFiles(paths: readonly string[]): Promise<void> {
  return changing(async () => {
    await Promise.all(paths.map((path) => fileHandle(path)));
    const directory = await root();

    try {
      await Promise.all(paths.map((path) => directory.removeEntry(fileName(path))));
    } finally {
      changed();
    }
  });
}

export function renameFile(path: string, target: string): Promise<void> {
  return changing(async () => {
    checkImageName(fileName(target), isImageName(fileName(path)));
    await (await fileHandle(path)).move(fileName(target));
    changed();
  });
}

/** Deletes all files, as part of resetting the app. */
export function clearFiles(): Promise<void> {
  return changing(async () => {
    const directory = await root();
    const names = await Array.fromAsync(directory.keys());
    await Promise.all(names.map((name) => directory.removeEntry(name, { recursive: true })));
    changed();
  });
}
