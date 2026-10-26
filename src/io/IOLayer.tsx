// IO module root: autosave restore, file drag & drop, export dialogs, library sidebar, presenter controls, PWA.
import { lazy, Suspense, useEffect, useLayoutEffect, useState } from "react";
import { useStore, getState, showToast } from "../core/store";
import { getAction } from "../core/actions";
import { isRestorePending, restoreFromLocal, restoreFromLocalSync, startAutosave } from "./autosave";
import { handleIncomingFiles } from "./files";
import { PromptHost, IoDialog } from "./Dialog";
import { PresenterControls } from "./PresenterControls";
import { SlidesPanel } from "./SlidesPanel";
import { initPWA } from "./pwa";
import { LIBRARY_DRAG_MIME, getLibraryItem, insertLibraryItems, loadLibrary } from "../library/store";
import { handleAddLibraryHash } from "../library/addLibraryHash";
import { DownloadIcon, FileIcon, ImageIcon, PdfIcon } from "./icons";
import "./actions";
import "../library/actions";
import "./io.css";

const ExportImageDialog = lazy(() => import("./ExportImageDialog").then((m) => ({ default: m.ExportImageDialog })));
const LibrarySidebar = lazy(() => import("../library/LibrarySidebar").then((m) => ({ default: m.LibrarySidebar })));

initPWA();

export function IOLayer() {
  const [restoring, setRestoring] = useState(isRestorePending);
  const openDialog = useStore((s) => s.appState.openDialog);
  const openSidebar = useStore((s) => s.appState.openSidebar);
  const bg = useStore((s) => s.appState.viewBackgroundColor);
  const dragging = useWindowDrop();

  // restore the autosaved scene before first paint when it is already read; otherwise cover the canvas until it is
  useLayoutEffect(() => {
    let stop: (() => void) | undefined;
    let alive = true;
    const begin = () => {
      if (!alive) return;
      setRestoring(false);
      stop = startAutosave();
    };
    if (restoreFromLocalSync()) begin();
    else
      restoreFromLocal()
        .catch((e) => console.warn("Restore failed", e))
        .finally(begin);
    return () => {
      alive = false;
      stop?.();
    };
  }, []);

  // #addLibrary=… links
  useEffect(() => {
    void handleAddLibraryHash();
    const onHash = () => void handleAddLibraryHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // files opened with the installed app (manifest file_handlers)
  useEffect(() => {
    const lq = (window as Window & { launchQueue?: { setConsumer(fn: (p: { files?: { getFile(): Promise<File>; kind?: string }[] }) => void): void } }).launchQueue;
    lq?.setConsumer(async (params) => {
      if (!params.files?.length) return;
      const entries = await Promise.all(params.files.map(async (h) => ({ file: await h.getFile(), handle: h as never })));
      await handleIncomingFiles(entries, "open");
    });
  }, []);

  // "library" dialog name maps to the sidebar
  useEffect(() => {
    if (openDialog === "library") getState().setAppState({ openDialog: null, openSidebar: "library" });
  }, [openDialog]);

  const closeDialog = () => getState().setAppState({ openDialog: null });

  return (
    <>
      {restoring && <div className="io-restoring" style={{ background: bg }} aria-hidden="true" />}
      <Suspense fallback={null}>
        {openDialog === "export-image" && <ExportImageDialog onClose={closeDialog} />}
        {openSidebar === "library" && <LibrarySidebar />}
      </Suspense>
      {openDialog === "export-json" && <SaveDialog onClose={closeDialog} />}
      {openDialog === "slides" && <SlidesPanel />}
      <PresenterControls />
      {dragging && (
        <div className="io-dropzone" aria-hidden="true">
          <div className="io-dropzone__card">
            <DownloadIcon />
            Drop to open a drawing, add a library or insert images
          </div>
        </div>
      )}
      <PromptHost />
    </>
  );
}

/** "Save to…" dialog (excalidraw's export-json): file, image, PDF. */
function SaveDialog({ onClose }: { onClose: () => void }) {
  const run = (id: string) => {
    onClose();
    const a = getAction(id);
    if (a) a.perform(getState(), "ui");
  };
  const cards = [
    { id: "io.save", icon: <FileIcon />, title: "Save to disk", text: "Save the drawing as an .excalidraw file you can open again later.", cta: "Save to file" },
    { id: "io.exportImage", icon: <ImageIcon />, title: "Export image", text: "Export as PNG or SVG, optionally with the scene embedded.", cta: "Export image" },
    { id: "io.exportPdf", icon: <PdfIcon />, title: "Export PDF", text: "One page per frame — or the whole drawing if there are no frames.", cta: "Export PDF" },
  ];
  return (
    <IoDialog title="Save to…" size="regular" onClose={onClose}>
      <div className="io-cards">
        {cards.map((c) => (
          <div key={c.id} className="io-card">
            <div className="io-card__icon">{c.icon}</div>
            <h3>{c.title}</h3>
            <p>{c.text}</p>
            <button className="io-btn io-btn--primary" onClick={() => run(c.id)}>
              {c.cta}
            </button>
          </div>
        ))}
      </div>
    </IoDialog>
  );
}

/** Window-level drag & drop for files and library items. Returns whether files are being dragged over the window. */
function useWindowDrop() {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const isFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    const isLib = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes(LIBRARY_DRAG_MIME);
    const onEnter = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (!isFiles(e) && !isLib(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = async (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (e.defaultPrevented || !e.dataTransfer) return; // consumed by another layer
      const point = { x: e.clientX, y: e.clientY };
      if (isLib(e)) {
        e.preventDefault();
        // dropping back onto the library itself does nothing
        if ((e.target as Element | null)?.closest?.(".io-library")) return;
        if (getState().appState.viewModeEnabled) return showToast("Can't add items in view mode.", "info");
        try {
          await loadLibrary();
          const ids = JSON.parse(e.dataTransfer.getData(LIBRARY_DRAG_MIME)) as string[];
          const items = ids.map(getLibraryItem).filter((i) => !!i);
          insertLibraryItems(items, point);
        } catch (err) {
          console.error(err);
        }
        return;
      }
      if (!isFiles(e)) return;
      e.preventDefault();
      const files = [...e.dataTransfer.files];
      if (!files.length) return;
      // keep the handle for .excalidraw files so Mod+S writes back to them (Chromium only)
      const handles = await Promise.all(
        [...e.dataTransfer.items].filter((it) => it.kind === "file").map(async (it) => {
          const getHandle = (it as DataTransferItem & { getAsFileSystemHandle?: () => Promise<unknown> }).getAsFileSystemHandle;
          if (!getHandle) return null;
          try {
            const h = (await getHandle.call(it)) as { kind?: string } | null;
            return h && h.kind === "file" ? (h as never) : null;
          } catch {
            return null;
          }
        }),
      ).catch(() => []);
      await handleIncomingFiles(
        files.map((file, i) => ({ file, handle: handles[i] ?? null })),
        "drop",
        point,
      );
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
  return dragging;
}
