import { useEffect, useState } from "react";
import "./ui.css";
import "./actions";
import { useStore } from "../core/store";
import { useDevice } from "../core/useDevice";
import { zoomIn, zoomOut, resetZoom } from "../core/viewport";
import { Toolbar } from "./Toolbar";
import { PropertiesPanel, usePanelVisible } from "./PropertiesPanel";
import { useGlobalKeyboard } from "./lib/keyboard";
import { Icons } from "./icons";
import { MainMenu } from "./MainMenu";
import { Dialogs } from "./Dialogs";

export function UILayer() {
  useGlobalKeyboard();
  const device = useDevice();
  const as = useStore((s) => s.appState);
  const set = useStore((s) => s.setAppState);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);
  const panel = usePanelVisible();
  const hasFrames = useStore((s) => s.elements.some((e) => e.type === "frame" && !e.isDeleted));
  const [styleOpen, setStyleOpen] = useState(false);

  useEffect(() => {
    if (!as.toast) return;
    const t = setTimeout(() => set({ toast: null }), 3000);
    return () => clearTimeout(t);
  }, [as.toast, set]);

  if (as.presentationMode) return null;
  const collabCount = Object.keys(as.collaborators).length;

  return (
    <div className={`ui-layer ${device.isMobile ? "is-mobile" : ""} ${as.openSidebar ? "has-sidebar" : ""}`}>
      {!as.zenModeEnabled && <MainMenu />}
      {!as.viewModeEnabled && (
        <div className="ui-top">
          <Toolbar mobile={device.isMobile} />
        </div>
      )}
      {!as.zenModeEnabled && (
        <div className="ui-topright">
          <div id="ui-topright-slot" />
          {hasFrames && (
            <button className="ui-btn" title="Present frames as slides" onClick={() => set({ openDialog: "slides" })}>
              Present
            </button>
          )}
          <button className="ui-btn ui-btn--primary" onClick={() => set({ openDialog: "collab" })}>
            Share{collabCount ? ` · ${collabCount}` : ""}
          </button>
          <button className="ui-btn" onClick={() => set({ openSidebar: as.openSidebar === "library" ? null : "library" })}>
            Library
          </button>
        </div>
      )}
      {panel && !as.zenModeEnabled && (!device.isMobile || styleOpen) && <PropertiesPanel className={device.isMobile ? "ui-panel--sheet" : ""} />}
      <div className="ui-bottom ui-island">
        {device.isMobile && panel && (
          <button className={`ui-icon-btn ui-style-btn ${styleOpen ? "is-active" : ""}`} aria-label="Style" onClick={() => setStyleOpen(!styleOpen)}>Style</button>
        )}
        <button className="ui-icon-btn" aria-label="Zoom out" onClick={zoomOut}>−</button>
        <button className="ui-icon-btn ui-zoom" aria-label="Reset zoom" onClick={resetZoom}>{Math.round(as.zoom * 100)}%</button>
        <button className="ui-icon-btn" aria-label="Zoom in" onClick={zoomIn}>+</button>
        {!as.viewModeEnabled && (
          <>
            <span className="ui-toolbar__sep" />
            <button className="ui-icon-btn" aria-label="Undo" disabled={!canUndo} onClick={undo}>{Icons.undo ?? "↶"}</button>
            <button className="ui-icon-btn" aria-label="Redo" disabled={!canRedo} onClick={redo}>{Icons.redo ?? "↷"}</button>
          </>
        )}
      </div>
      {(as.zenModeEnabled || as.viewModeEnabled) && (
        <button className="ui-btn ui-exit-pill" onClick={() => set({ zenModeEnabled: false, viewModeEnabled: false })}>
          Exit {as.viewModeEnabled ? "view" : "zen"} mode
        </button>
      )}
      <Dialogs />
      {as.toast && <div className={`ui-toast ui-toast--${as.toast.kind ?? "info"}`}>{as.toast.message}</div>}
    </div>
  );
}
