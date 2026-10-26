import { create } from "zustand";
import type { AppState, BinaryFile, BinaryFiles, ExcalidrawElement } from "./types";
import { randomInteger } from "./utils";

export const LIGHT_BG = "#ffffff";
export const DARK_BG = "#121212";

export const getDefaultAppState = (): AppState => ({
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
  width: typeof window !== "undefined" ? window.innerWidth : 1200,
  height: typeof window !== "undefined" ? window.innerHeight : 800,

  activeTool: "selection",
  toolLocked: false,
  lastActiveTool: "selection",
  penMode: false,

  currentItemStrokeColor: "#1e1e1e",
  currentItemBackgroundColor: "transparent",
  currentItemFillStyle: "solid",
  currentItemStrokeWidth: 2,
  currentItemStrokeStyle: "solid",
  currentItemRoughness: 1,
  currentItemRoundness: "round",
  currentItemOpacity: 100,
  currentItemFontFamily: 5,
  currentItemFontSize: 20,
  currentItemTextAlign: "left",
  currentItemStartArrowhead: null,
  currentItemEndArrowhead: "arrow",
  currentItemArrowType: "round",

  selectedElementIds: {},
  editingGroupId: null,
  editingTextId: null,
  editingLinearId: null,
  croppingImageId: null,
  editingFrameNameId: null,

  theme: "light",
  viewBackgroundColor: LIGHT_BG,
  gridModeEnabled: false,
  gridSize: 20,
  objectsSnapModeEnabled: false,
  zenModeEnabled: false,
  viewModeEnabled: false,
  statsOpen: false,
  presentationMode: null,
  slides: { order: [], hidden: [] },

  openDialog: null,
  openSidebar: null,
  openMenu: null,
  contextMenu: null,
  toast: null,
  name: "Untitled drawing",

  collaborators: {},
  followingUserId: null,
  username: "",
});

/** AppState keys that are persisted with a scene / autosave. Everything else is session-only. */
export const PERSISTED_APPSTATE_KEYS = [
  "slides",
  "scrollX",
  "scrollY",
  "zoom",
  "theme",
  "viewBackgroundColor",
  "gridModeEnabled",
  "gridSize",
  "objectsSnapModeEnabled",
  "name",
  "currentItemStrokeColor",
  "currentItemBackgroundColor",
  "currentItemFillStyle",
  "currentItemStrokeWidth",
  "currentItemStrokeStyle",
  "currentItemRoughness",
  "currentItemRoundness",
  "currentItemOpacity",
  "currentItemFontFamily",
  "currentItemFontSize",
  "currentItemTextAlign",
  "currentItemStartArrowhead",
  "currentItemEndArrowhead",
  "currentItemArrowType",
  "username",
] as const satisfies readonly (keyof AppState)[];

interface HistoryEntry {
  elements: ExcalidrawElement[];
  selectedElementIds: Record<string, true>;
}

export interface Store {
  /** All elements in z-order (index 0 = bottom). Includes soft-deleted ones (isDeleted) for collab. */
  elements: ExcalidrawElement[];
  files: BinaryFiles;
  appState: AppState;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  /** Bumped on every scene change so canvases know to repaint. */
  sceneNonce: number;

  // ---- mutations -------------------------------------------------------
  /** Replace the element list wholesale (z-order = array order). Does NOT record history. */
  setElements: (elements: ExcalidrawElement[]) => void;
  /** Patch one or more elements by id. Bumps version. Does NOT record history. */
  mutateElements: (patches: Record<string, Partial<ExcalidrawElement>>) => void;
  setAppState: (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
  addFiles: (files: BinaryFile[]) => void;

  // ---- history ---------------------------------------------------------
  /** Snapshot the CURRENT elements onto the undo stack. Call BEFORE a user-visible change. */
  recordHistory: () => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
}

const MAX_HISTORY = 100;

const bump = (el: ExcalidrawElement): ExcalidrawElement => ({
  ...el,
  version: el.version + 1,
  versionNonce: randomInteger(),
  updated: Date.now(),
});

export const useStore = create<Store>((set, get) => ({
  elements: [],
  files: {},
  appState: getDefaultAppState(),
  undoStack: [],
  redoStack: [],
  sceneNonce: 0,

  setElements: (elements) => set((s) => ({ elements, sceneNonce: s.sceneNonce + 1 })),

  mutateElements: (patches) =>
    set((s) => ({
      elements: s.elements.map((el) =>
        patches[el.id] ? (bump({ ...el, ...patches[el.id] } as ExcalidrawElement)) : el,
      ),
      sceneNonce: s.sceneNonce + 1,
    })),

  setAppState: (patch) =>
    set((s) => ({
      appState: { ...s.appState, ...(typeof patch === "function" ? patch(s.appState) : patch) },
    })),

  addFiles: (files) =>
    set((s) => {
      const next = { ...s.files };
      for (const f of files) next[f.id] = f;
      return { files: next, sceneNonce: s.sceneNonce + 1 };
    }),

  recordHistory: () => {
    const { elements, appState, undoStack } = get();
    const top = undoStack[undoStack.length - 1];
    if (top && top.elements === elements) return; // nothing changed since last snapshot
    set({
      undoStack: [...undoStack, { elements, selectedElementIds: appState.selectedElementIds }].slice(
        -MAX_HISTORY,
      ),
      redoStack: [],
    });
  },

  undo: () => {
    const { undoStack, redoStack, elements, appState } = get();
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    set((s) => ({
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, { elements, selectedElementIds: appState.selectedElementIds }],
      elements: restoreVersions(prev.elements, elements),
      appState: { ...s.appState, selectedElementIds: prev.selectedElementIds, editingTextId: null },
      sceneNonce: s.sceneNonce + 1,
    }));
  },

  redo: () => {
    const { undoStack, redoStack, elements, appState } = get();
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    set((s) => ({
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, { elements, selectedElementIds: appState.selectedElementIds }],
      elements: restoreVersions(next.elements, elements),
      appState: { ...s.appState, selectedElementIds: next.selectedElementIds, editingTextId: null },
      sceneNonce: s.sceneNonce + 1,
    }));
  },

  clearHistory: () => set({ undoStack: [], redoStack: [] }),
}));

/**
 * When restoring a snapshot, give every element that differs from the current one a
 * version higher than the current one, so collaborators accept the undo as the newest change.
 */
function restoreVersions(target: ExcalidrawElement[], current: ExcalidrawElement[]) {
  const currentById = new Map(current.map((e) => [e.id, e]));
  const targetIds = new Set(target.map((e) => e.id));
  const restored = target.map((el) => {
    const cur = currentById.get(el.id);
    if (!cur || cur === el) return el;
    return { ...el, version: cur.version + 1, versionNonce: randomInteger(), updated: Date.now() };
  });
  // elements created after the snapshot are soft-deleted rather than dropped (keeps collab in sync)
  for (const cur of current) {
    if (!targetIds.has(cur.id) && !cur.isDeleted) {
      restored.push({ ...cur, isDeleted: true, version: cur.version + 1, updated: Date.now() });
    }
  }
  return restored;
}

// ---- convenience selectors (usable outside React) ------------------------

export const getState = () => useStore.getState();

export const getNonDeletedElements = (elements = getState().elements) =>
  elements.filter((e) => !e.isDeleted);

export const getSelectedElements = (s: Store = getState()) =>
  s.elements.filter((e) => !e.isDeleted && s.appState.selectedElementIds[e.id]);

export const getElementById = (id: string, elements = getState().elements) =>
  elements.find((e) => e.id === id);

export const showToast = (message: string, kind: "info" | "error" | "success" = "info") => {
  getState().setAppState({ toast: { message, kind } });
};
