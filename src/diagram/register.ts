// EAGER entry of the diagram module: action registration + paste handler.
// Import once from main.tsx. Keep this file tiny — no React, no dagre, no dialogs (those are lazy).
import { registerActions } from "../core/actions";
import { registerPasteHandler } from "../core/events";
import { getState, getSelectedElements, type Store } from "../core/store";
import type { DialogName } from "../core/types";
import { parseTable } from "./chart/table";
import { session } from "./session";

const open = (dialog: DialogName) => getState().setAppState({ openDialog: dialog, contextMenu: null, openMenu: null });

const singleFrameSelected = (s: Store) => {
  const sel = getSelectedElements(s);
  return sel.length === 1 && sel[0].type === "frame";
};

const MERMAID_START =
  /^\s*(?:---[\s\S]*?---\s*)?(?:%%.*\n\s*)*(?:(?:flowchart|graph)(?:\s+(?:TB|TD|BT|LR|RL))?\s*;?\s*$|(?:sequenceDiagram|classDiagram(?:-v2)?|erDiagram|stateDiagram(?:-v2)?)\s*$|pie(?:\s+(?:showData|title\b.*))?\s*$)/m;

/** True when the pasted text starts with a Mermaid diagram header. */
export const looksLikeMermaid = (text: string) => {
  const first = text.trim().split("\n").find((l) => l.trim() && !l.trim().startsWith("%%"));
  return !!first && MERMAID_START.test(first) && text.trim().split("\n").length > 1;
};

registerActions([
  {
    id: "diagram.mermaid",
    label: "Mermaid to Excalidraw",
    category: "generate",
    keywords: ["mermaid", "flowchart", "sequence", "diagram", "graph", "class", "er", "state", "pie", "import", "code"],
    icon: "M4 5h16v14H4z M7 15V9l3 3 3-3v6 M16 9v6",
    perform: () => {
      session.mermaidDraft = null;
      open("mermaid");
    },
  },
  {
    id: "diagram.textToDiagram",
    label: "Text to diagram",
    category: "generate",
    keywords: ["ai", "generate", "prompt", "describe", "text", "diagram", "magic", "gpt", "claude"],
    icon: "M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z M5 16l.9 2.1L8 19l-2.1.9L5 22l-.9-2.1L2 19l2.1-.9z",
    perform: () => open("text-to-diagram"),
  },
  {
    id: "diagram.wireframeToCode",
    label: "Wireframe to code",
    category: "generate",
    keywords: ["ai", "wireframe", "html", "code", "frame", "ui", "mockup", "generate", "magic"],
    icon: "M3 5h18v14H3z M3 9h18 M8 13l-2 2 2 2 M16 13l2 2-2 2",
    predicate: singleFrameSelected,
    contextMenu: "element",
    perform: () => open("wireframe-to-code"),
  },
  {
    id: "diagram.wireframeToCodeHelp",
    label: "Wireframe to code",
    category: "generate",
    keywords: ["ai", "wireframe", "html", "code", "frame", "ui", "mockup", "generate", "magic"],
    icon: "M3 5h18v14H3z M3 9h18 M8 13l-2 2 2 2 M16 13l2 2-2 2",
    predicate: (s) => !singleFrameSelected(s),
    perform: () => open("wireframe-to-code"),
  },
  {
    id: "diagram.chart",
    label: "Insert chart from data",
    category: "generate",
    keywords: ["chart", "graph", "bar", "line", "csv", "spreadsheet", "excel", "table", "data", "plot"],
    icon: "M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16v-6",
    perform: () => open("chart"),
  },
]);

registerPasteHandler(({ text, files }) => {
  const as = getState().appState;
  if (files.length || !text || as.openDialog || as.editingTextId || as.viewModeEnabled) return false;
  if (looksLikeMermaid(text)) {
    session.mermaidDraft = text.trim();
    open("mermaid");
    return true;
  }
  const data = parseTable(text);
  if (!data) return false;
  session.chart = { raw: text.trim(), data };
  open("chart");
  return true;
}, 10);
