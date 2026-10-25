import { useSyncExternalStore } from "react";
import { getState } from "../../core/store";
import { insertImageFiles } from "../../canvas/api";
import type { ShapeType, ToolType } from "../../core/types";

export const EXTENDED_SHAPES: ShapeType[] = ["triangle", "star", "hexagon", "cylinder", "cloud", "callout"];

// ---- last used extended shape (shown on the shapes dropdown button) ------
const LS_KEY = "excalimade:lastShape";
let lastShape: ShapeType = (() => {
  try {
    const v = localStorage.getItem(LS_KEY) as ShapeType | null;
    if (v && EXTENDED_SHAPES.includes(v)) return v;
  } catch {
    /* storage unavailable */
  }
  return "triangle";
})();
const shapeListeners = new Set<() => void>();
export const useLastShape = () =>
  useSyncExternalStore(
    (cb) => {
      shapeListeners.add(cb);
      return () => void shapeListeners.delete(cb);
    },
    () => lastShape,
  );
function rememberShape(t: ShapeType) {
  if (t === lastShape) return;
  lastShape = t;
  try {
    localStorage.setItem(LS_KEY, t);
  } catch {
    /* ignore */
  }
  shapeListeners.forEach((l) => l());
}

// ---- image picking ---------------------------------------------------------
export function pickImages() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*,.svg";
  input.multiple = true;
  input.style.display = "none";
  input.addEventListener("change", () => {
    const files = [...(input.files ?? [])];
    input.remove();
    if (files.length) void insertImageFiles(files);
  });
  input.addEventListener("cancel", () => input.remove());
  document.body.appendChild(input);
  input.click();
}

/** Switch the active tool the way the toolbar does (image → file picker, embed → URL dialog). */
export function setTool(tool: ToolType) {
  const { setAppState } = getState();
  if (tool === "image") {
    pickImages();
    return;
  }
  if (tool === "embeddable") {
    setAppState({ openDialog: "embed", openMenu: null });
    return;
  }
  if ((EXTENDED_SHAPES as string[]).includes(tool)) rememberShape(tool as ShapeType);
  const keepSelection = tool === "selection" || tool === "hand" || tool === "laser";
  setAppState({
    activeTool: tool,
    openMenu: null,
    contextMenu: null,
    editingLinearId: null,
    ...(keepSelection ? {} : { selectedElementIds: {}, editingGroupId: null }),
  });
}

export const DRAWING_TOOLS: ToolType[] = [
  "rectangle",
  "diamond",
  "ellipse",
  ...EXTENDED_SHAPES,
  "arrow",
  "line",
  "freedraw",
  "text",
];
