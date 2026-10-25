// io.* command registrations (keyboard, command palette, menus, context menu).
import { registerActions, type Action } from "../core/actions";
import { getNonDeletedElements, showToast } from "../core/store";
import { openSceneFromDisk, saveScene, saveSceneAs } from "./files";
import { quickCopy } from "./exportImage";
import { startPresentation } from "./presentation";
import { canInstall, promptInstall, subscribeInstall } from "./pwa";

const hasContent = () => getNonDeletedElements().length > 0;

const installAction: Action = {
  id: "io.install",
  label: "Install app",
  category: "help",
  keywords: ["pwa", "offline", "desktop", "home screen", "add"],
  predicate: () => canInstall(),
  perform: () => void promptInstall(),
};

registerActions([
  {
    id: "io.open",
    label: "Open…",
    category: "export",
    keywords: ["load", "file", "import", "excalidraw", "json", "png", "svg", "library"],
    shortcuts: ["Mod+O"],
    perform: () => void openSceneFromDisk(),
  },
  {
    id: "io.save",
    label: "Save to disk",
    category: "export",
    keywords: ["save", "file", "download", "excalidraw", "json"],
    shortcuts: ["Mod+S"],
    perform: () => void saveScene(),
  },
  {
    id: "io.saveAs",
    label: "Save as…",
    category: "export",
    keywords: ["save", "file", "download", "copy", "excalidraw"],
    shortcuts: ["Mod+Shift+S"],
    perform: () => void saveSceneAs(),
  },
  {
    id: "io.exportImage",
    label: "Export image…",
    category: "export",
    keywords: ["png", "svg", "picture", "download", "clipboard", "save"],
    shortcuts: ["Mod+Shift+E"],
    predicate: () => hasContent(),
    perform: (s) => s.setAppState({ openDialog: "export-image", contextMenu: null }),
  },
  {
    id: "io.copyAsPng",
    label: "Copy to clipboard as PNG",
    category: "export",
    keywords: ["image", "clipboard", "png", "picture"],
    shortcuts: ["Alt+Shift+C"],
    contextMenu: "both",
    predicate: () => hasContent(),
    perform: () => void quickCopy("png"),
  },
  {
    id: "io.copyAsSvg",
    label: "Copy to clipboard as SVG",
    category: "export",
    keywords: ["image", "clipboard", "svg", "vector"],
    contextMenu: "both",
    predicate: () => hasContent(),
    perform: () => void quickCopy("svg"),
  },
  {
    id: "io.exportPdf",
    label: "Export to PDF",
    category: "export",
    keywords: ["pdf", "print", "frames", "slides", "document"],
    predicate: () => hasContent(),
    perform: () =>
      void import("./exportPdf")
        .then((m) => m.exportPdf())
        .catch(() => showToast("Couldn't load the PDF exporter.", "error")),
  },
  {
    id: "io.present",
    label: "Start presentation",
    category: "view",
    keywords: ["present", "slides", "frames", "slideshow", "fullscreen"],
    shortcuts: ["Alt+P"],
    predicate: (s) => !s.appState.presentationMode && s.elements.some((e) => e.type === "frame" && !e.isDeleted),
    perform: () => void startPresentation(),
  },
  installAction,
]);

// re-register so menus/palette re-check the predicate when the install prompt becomes available
subscribeInstall(() => registerActions([installAction]));
