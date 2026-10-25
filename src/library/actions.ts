// library.* command registrations.
import { registerActions } from "../core/actions";
import { getSelectedElements, showToast } from "../core/store";
import { addElementsToLibrary, addLibraryItems, useLibrary } from "./store";
import { openFiles } from "../io/fileio";
import { parseLibrary } from "./format";
import { EXCALIDRAW_LIB_MIME } from "../io/encode";

export async function importLibraryFromDisk() {
  const files = await openFiles({
    description: "Excalidraw library",
    extensions: [".excalidrawlib", ".json"],
    mimeTypes: [EXCALIDRAW_LIB_MIME, "application/json"],
    multiple: true,
  });
  let added = 0;
  for (const { file } of files) {
    try {
      added += await addLibraryItems(parseLibrary(await file.text()));
    } catch (e) {
      showToast(`${file.name}: ${e instanceof Error ? e.message : "invalid library"}`, "error");
      return;
    }
  }
  if (files.length) showToast(added ? `Added ${added} item${added === 1 ? "" : "s"} to your library` : "These items are already in your library", added ? "success" : "info");
}

registerActions([
  {
    id: "library.add",
    label: "Add to library",
    category: "library",
    keywords: ["library", "save", "reuse", "component", "stencil"],
    contextMenu: "element",
    predicate: (s) => Object.keys(s.appState.selectedElementIds).length > 0,
    perform: (s) => {
      void addElementsToLibrary(getSelectedElements(s));
      s.setAppState({ contextMenu: null });
    },
  },
  {
    id: "library.toggle",
    label: "Library",
    category: "library",
    keywords: ["library", "sidebar", "items", "shapes", "stencils", "components"],
    perform: (s) => s.setAppState({ openSidebar: s.appState.openSidebar === "library" ? null : "library" }),
  },
  {
    id: "library.import",
    label: "Import library from file…",
    category: "library",
    keywords: ["library", "excalidrawlib", "open", "load"],
    perform: () => void importLibraryFromDisk(),
  },
  {
    id: "library.browse",
    label: "Browse public libraries",
    category: "library",
    keywords: ["library", "community", "public", "templates", "icons", "download"],
    perform: (s) => {
      useLibrary.setState({ tab: "browse" });
      s.setAppState({ openSidebar: "library" });
    },
  },
]);
