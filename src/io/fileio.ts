// File System Access API wrappers with <input type=file> / download-link fallbacks.

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}
interface FSFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  queryPermission?(opts: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(opts: { mode: "readwrite" }): Promise<PermissionState>;
}
type FSWindow = Window & {
  showOpenFilePicker?: (opts: { types?: FilePickerAcceptType[]; multiple?: boolean; excludeAcceptAllOption?: boolean }) => Promise<FSFileHandle[]>;
  showSaveFilePicker?: (opts: { suggestedName?: string; types?: FilePickerAcceptType[] }) => Promise<FSFileHandle>;
};
export type FileHandle = FSFileHandle;

const w = () => window as FSWindow;
export const supportsFileSystemAccess = () =>
  typeof window !== "undefined" && typeof w().showOpenFilePicker === "function" && typeof w().showSaveFilePicker === "function" && window.self === window.top;

export const isAbortError = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export interface OpenedFile {
  file: File;
  handle: FileHandle | null;
}

/** Ask the user for file(s). Resolves to [] when cancelled. */
export async function openFiles(opts: {
  description: string;
  extensions: string[]; // with dots
  mimeTypes: string[];
  multiple?: boolean;
}): Promise<OpenedFile[]> {
  if (supportsFileSystemAccess()) {
    try {
      const accept: Record<string, string[]> = {};
      for (const m of opts.mimeTypes) accept[m] = [];
      // put all extensions on a generic type so "*.excalidraw" files without a registered mime are selectable
      accept["application/octet-stream"] = opts.extensions;
      const handles = await w().showOpenFilePicker!({
        types: [{ description: opts.description, accept }],
        multiple: !!opts.multiple,
      });
      return Promise.all(handles.map(async (h) => ({ file: await h.getFile(), handle: h })));
    } catch (e) {
      if (isAbortError(e)) return [];
      // SecurityError / TypeError (unsupported accept types) → fall back
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = !!opts.multiple;
    input.accept = [...opts.extensions, ...opts.mimeTypes].join(",");
    input.style.display = "none";
    let done = false;
    const finish = (files: OpenedFile[]) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish([...(input.files ?? [])].map((file) => ({ file, handle: null }))));
    input.addEventListener("cancel", () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

export const sanitizeFileName = (name: string) =>
  (name || "Untitled").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Save a blob. With `handle` it overwrites that file (no prompt); otherwise shows the save picker
 * (or downloads). Resolves to the handle written to (null for downloads), or "cancelled".
 */
export async function saveBlob(
  blob: Blob,
  opts: { name: string; extension: string; mimeType: string; description: string; handle?: FileHandle | null },
): Promise<FileHandle | null | "cancelled"> {
  const fileName = `${sanitizeFileName(opts.name)}${opts.extension}`;
  if (supportsFileSystemAccess()) {
    try {
      let handle = opts.handle ?? null;
      if (handle?.queryPermission && (await handle.queryPermission({ mode: "readwrite" })) !== "granted") {
        if ((await handle.requestPermission?.({ mode: "readwrite" })) !== "granted") handle = null;
      }
      if (!handle) {
        handle = await w().showSaveFilePicker!({
          suggestedName: fileName,
          types: [{ description: opts.description, accept: { [opts.mimeType]: [opts.extension] } }],
        });
      }
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return handle;
    } catch (e) {
      if (isAbortError(e)) return "cancelled";
      if (opts.handle) throw e;
      // picker unavailable (e.g. insecure context) → download
    }
  }
  downloadBlob(blob, fileName);
  return null;
}

export const fileExtension = (name: string) => {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
};
export const stripExtension = (name: string) => name.replace(/\.(excalidraw|excalidrawlib|json|png|svg)$/i, "");
