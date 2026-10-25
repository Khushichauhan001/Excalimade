// `#addLibrary=<url>&token=<…>` — the excalidraw.com convention used by libraries.excalidraw.com's "Add to Excalidraw".
import { getState, showToast } from "../core/store";
import { confirmDialog } from "../io/Dialog";
import { parseLibrary } from "./format";
import { addLibraryItems } from "./store";

const LIB_HOST = "libraries.excalidraw.com";

/** Proxy URL for a libraries.excalidraw.com file (avoids CORS + caches server-side), or null. */
export function proxiedLibraryUrl(url: URL): string | null {
  if (url.hostname !== LIB_HOST) return null;
  const m = url.pathname.match(/^\/libraries\/(.+\.excalidrawlib)$/);
  return m ? `/api/libraries/file?path=${encodeURIComponent(decodeURIComponent(m[1]))}` : null;
}

export async function fetchLibraryFromUrl(raw: string) {
  const url = new URL(raw, location.href);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported library URL");
  const res = await fetch(proxiedLibraryUrl(url) ?? url.href, { credentials: "omit" });
  if (!res.ok) throw new Error(`Couldn't download the library (${res.status})`);
  return parseLibrary(await res.text());
}

function clearHashParams() {
  const params = new URLSearchParams(location.hash.slice(1));
  params.delete("addLibrary");
  params.delete("token");
  const rest = params.toString();
  history.replaceState(history.state, "", `${location.pathname}${location.search}${rest ? `#${rest}` : ""}`);
}

let handling = false;
export async function handleAddLibraryHash() {
  if (handling || !location.hash.includes("addLibrary=")) return;
  const raw = new URLSearchParams(location.hash.slice(1)).get("addLibrary");
  if (!raw) return;
  handling = true;
  clearHashParams();
  try {
    let host = "";
    try {
      host = new URL(raw).hostname;
    } catch {
      throw new Error("Invalid library link");
    }
    const items = await fetchLibraryFromUrl(raw);
    if (!items.length) throw new Error("The library is empty");
    const ok = await confirmDialog({
      title: "Add library?",
      message: `Add ${items.length} item${items.length === 1 ? "" : "s"} from ${host} to your library?`,
      confirmLabel: "Add to library",
    });
    if (!ok) return;
    const n = await addLibraryItems(items);
    getState().setAppState({ openSidebar: "library" });
    showToast(n ? `Added ${n} item${n === 1 ? "" : "s"} to your library` : "These items are already in your library", n ? "success" : "info");
  } catch (e) {
    showToast(e instanceof Error ? e.message : "Couldn't add the library", "error");
  } finally {
    handling = false;
  }
}
