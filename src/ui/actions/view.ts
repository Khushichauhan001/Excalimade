import { registerActions, type Action } from "../../core/actions";
import { DARK_BG, LIGHT_BG, getSelectedElements, type Store } from "../../core/store";
import { resetZoom, zoomIn, zoomOut, zoomToFit } from "../../core/viewport";
import type { ToolType } from "../../core/types";
import { canEdit, hasSelection } from "../lib/scene";
import { setTool } from "../lib/tools";

export function toggleTheme(s: Store) {
  const theme = s.appState.theme === "dark" ? "light" : "dark";
  const patch: Partial<Store["appState"]> = { theme };
  s.setAppState(patch);
}

const toggleDialog = (s: Store, d: NonNullable<Store["appState"]["openDialog"]>) =>
  s.setAppState({ openDialog: s.appState.openDialog === d ? null : d, openMenu: null, contextMenu: null });

const viewActions: Action[] = [
  { id: "view.zoomIn", label: "Zoom in", category: "view", shortcuts: ["Mod+=", "Mod++"], perform: () => zoomIn() },
  { id: "view.zoomOut", label: "Zoom out", category: "view", shortcuts: ["Mod+-"], perform: () => zoomOut() },
  { id: "view.resetZoom", label: "Reset zoom", category: "view", keywords: ["100%"], shortcuts: ["Mod+0"], perform: () => resetZoom() },
  {
    id: "view.zoomToFit",
    label: "Zoom to fit all elements",
    category: "view",
    keywords: ["fit", "overview"],
    shortcuts: ["Shift+1"],
    predicate: (s) => s.elements.some((e) => !e.isDeleted),
    perform: () => zoomToFit(undefined, { animate: true, maxZoom: 2 }),
    contextMenu: "canvas",
  },
  {
    id: "view.zoomToSelection",
    label: "Zoom to selection",
    category: "view",
    shortcuts: ["Shift+2"],
    predicate: hasSelection,
    perform: (s) => zoomToFit(getSelectedElements(s), { animate: true, maxZoom: 8 }),
  },
  {
    id: "view.toggleGrid",
    label: "Toggle grid",
    category: "view",
    shortcuts: ["Mod+'"],
    perform: (s) => s.setAppState({ gridModeEnabled: !s.appState.gridModeEnabled }),
    contextMenu: "canvas",
  },
  {
    id: "view.toggleSnap",
    label: "Toggle object snapping",
    category: "view",
    keywords: ["snap", "magnet"],
    shortcuts: ["Alt+S"],
    perform: (s) => s.setAppState({ objectsSnapModeEnabled: !s.appState.objectsSnapModeEnabled }),
    contextMenu: "canvas",
  },
  {
    id: "view.zenMode",
    label: "Toggle zen mode",
    category: "view",
    keywords: ["focus", "distraction free"],
    shortcuts: ["Alt+Z"],
    perform: (s) => s.setAppState({ zenModeEnabled: !s.appState.zenModeEnabled }),
    contextMenu: "canvas",
  },
  {
    id: "view.viewMode",
    label: "Toggle view mode",
    category: "view",
    keywords: ["read only", "present"],
    shortcuts: ["Alt+R"],
    perform: (s) =>
      s.setAppState({
        viewModeEnabled: !s.appState.viewModeEnabled,
        selectedElementIds: {},
        activeTool: !s.appState.viewModeEnabled ? "hand" : "selection",
      }),
    contextMenu: "canvas",
  },
  {
    id: "view.darkMode",
    label: "Toggle dark mode",
    category: "view",
    keywords: ["theme", "light", "dark", "night"],
    shortcuts: ["Alt+Shift+D"],
    perform: toggleTheme,
    contextMenu: "canvas",
  },
  {
    id: "view.stats",
    label: "Toggle stats for nerds",
    category: "view",
    keywords: ["statistics", "position", "size", "dimensions"],
    shortcuts: ["Alt+/"],
    perform: (s) => s.setAppState({ statsOpen: !s.appState.statsOpen }),
    contextMenu: "canvas",
  },
  {
    id: "ui.commandPalette",
    label: "Command palette",
    category: "help",
    keywords: ["commands", "actions", "search"],
    shortcuts: ["Mod+/", "Mod+Shift+P"],
    perform: (s) => toggleDialog(s, "command-palette"),
    palette: false,
  },
  {
    id: "ui.find",
    label: "Find on canvas",
    category: "editor",
    keywords: ["search", "text"],
    shortcuts: ["Mod+F"],
    perform: (s) => {
      if (s.appState.openDialog === "find") {
        // already open: refocus the search field
        document.querySelector<HTMLInputElement>(".ui-find__input")?.select();
        return;
      }
      s.setAppState({ openDialog: "find", openMenu: null, contextMenu: null });
    },
  },
  {
    id: "ui.help",
    label: "Help & keyboard shortcuts",
    category: "help",
    keywords: ["shortcuts", "keys", "about"],
    shortcuts: ["?"],
    perform: (s) => toggleDialog(s, "help"),
  },
  {
    id: "tool.toggleLock",
    label: "Keep selected tool active after drawing",
    category: "tools",
    keywords: ["tool lock", "sticky"],
    shortcuts: ["Q"],
    predicate: canEdit,
    perform: (s) => s.setAppState({ toolLocked: !s.appState.toolLocked }),
  },
];

// ---- tools --------------------------------------------------------------------------
export interface ToolDef {
  tool: ToolType;
  label: string;
  shortcuts?: string[];
  keywords?: string[];
}

export const TOOL_DEFS: ToolDef[] = [
  { tool: "hand", label: "Hand (panning tool)", shortcuts: ["H"], keywords: ["pan", "move"] },
  { tool: "selection", label: "Selection", shortcuts: ["V", "1"], keywords: ["pointer", "select"] },
  { tool: "rectangle", label: "Rectangle", shortcuts: ["R", "2"], keywords: ["box", "square"] },
  { tool: "diamond", label: "Diamond", shortcuts: ["D", "3"], keywords: ["rhombus", "decision"] },
  { tool: "ellipse", label: "Ellipse", shortcuts: ["O", "4"], keywords: ["circle", "oval"] },
  { tool: "arrow", label: "Arrow", shortcuts: ["A", "5"], keywords: ["connector"] },
  { tool: "line", label: "Line", shortcuts: ["L", "6"], keywords: ["polyline", "polygon"] },
  { tool: "freedraw", label: "Draw", shortcuts: ["P", "7"], keywords: ["pencil", "pen", "free draw", "sketch"] },
  { tool: "text", label: "Text", shortcuts: ["T", "8"], keywords: ["type", "write"] },
  { tool: "image", label: "Insert image", shortcuts: ["9"], keywords: ["picture", "photo", "upload"] },
  { tool: "eraser", label: "Eraser", shortcuts: ["E", "0"], keywords: ["erase", "remove"] },
  { tool: "frame", label: "Frame tool", shortcuts: ["F"], keywords: ["artboard", "slide"] },
  { tool: "embeddable", label: "Web embed", keywords: ["iframe", "youtube", "figma", "website"] },
  { tool: "laser", label: "Laser pointer", shortcuts: ["K"], keywords: ["presentation", "highlight"] },
  { tool: "triangle", label: "Triangle", keywords: ["shape"] },
  { tool: "star", label: "Star", keywords: ["shape"] },
  { tool: "hexagon", label: "Hexagon", keywords: ["shape"] },
  { tool: "cylinder", label: "Cylinder", keywords: ["shape", "database"] },
  { tool: "cloud", label: "Cloud", keywords: ["shape"] },
  { tool: "callout", label: "Callout", keywords: ["shape", "speech bubble", "comment"] },
];

export const toolDef = (t: ToolType) => TOOL_DEFS.find((d) => d.tool === t);

const VIEW_SAFE_TOOLS: ToolType[] = ["hand", "selection", "laser"];

const toolActions: Action[] = TOOL_DEFS.map((d) => ({
  id: `tool.${d.tool}`,
  label: d.label,
  category: "tools",
  keywords: ["tool", ...(d.keywords ?? [])],
  shortcuts: d.shortcuts,
  predicate: (s: Store) => VIEW_SAFE_TOOLS.includes(d.tool) || canEdit(s),
  perform: () => setTool(d.tool),
}));

registerActions([...toolActions, ...viewActions]);
