// The browser's origin private file system, one flat directory shared by all chats.
// Only text is ever written to it, by the tools, Python and uploads of text files.

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

export function subscribeFiles(listener: () => void): () => void {
  changes.addEventListener("change", listener);
  return () => changes.removeEventListener("change", listener);
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
      throw Object.assign(new Error(`No such file: ${name}`), { name: "FileNotFoundError" });
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

export async function readFile(path: string): Promise<string> {
  return (await (await fileHandle(path)).getFile()).text();
}

export async function writeFile(path: string, content: string): Promise<void> {
  const handle = await (await root()).getFileHandle(fileName(path), { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
  changed();
}

export async function deleteFile(path: string): Promise<void> {
  await fileHandle(path);
  await (await root()).removeEntry(fileName(path));
  changed();
}

export async function renameFile(path: string, target: string): Promise<void> {
  await (await fileHandle(path)).move(fileName(target));
  changed();
}
