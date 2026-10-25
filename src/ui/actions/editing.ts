import { registerActions, type Action } from "../../core/actions";
import { getSelectedElements, getState, type Store } from "../../core/store";
import { duplicateElements, newFrame } from "../../core/elements";
import { refreshTextLayout, updateBoundElements } from "../../core/binding";
import { getCommonBounds } from "../../core/geometry";
import {
  copySelection,
  cutSelection,
  deleteSelection,
  pasteFromClipboard,
  startTextEditing,
} from "../../canvas/api";
import { SHAPE_TYPES, type ExcalidrawElement, type ShapeType, type TextElement } from "../../core/types";
import {
  byId,
  canEdit,
  editableSelection,
  expandSelection,
  getBoundText,
  getUnits,
  hasSelection,
  isBoundText,
  isShape,
  isText,
  measureFreeText,
  newGroupId,
  styleTargets,
  unitGroupId,
} from "../lib/scene";
import { setTool } from "../lib/tools";

const editableHasSel = (s: Store) => canEdit(s) && editableSelection(s).length > 0;

// ---- duplicate ---------------------------------------------------------------
function duplicate(s: Store) {
  const sel = editableSelection(s);
  if (!sel.length) return;
  const all = s.elements;
  const src = expandSelection(sel, all);
  s.recordHistory();
  const eg = s.appState.editingGroupId;
  const copies = duplicateElements(src, [10, 10]).map((c, i) => {
    if (!eg) return c;
    const orig = src[i].groupIds;
    const gi = orig.indexOf(eg);
    if (gi < 0) return c;
    // copies stay inside the group being edited (and its ancestors)
    return { ...c, groupIds: c.groupIds.map((g, j) => (j >= gi ? orig[j] : g)) } as ExcalidrawElement;
  });
  const lastIdx = Math.max(...src.map((e) => all.indexOf(e)));
  getState().setElements([...all.slice(0, lastIdx + 1), ...copies, ...all.slice(lastIdx + 1)]);
  const selIds = s.appState.selectedElementIds;
  const nextSel: Record<string, true> = {};
  copies.forEach((c, i) => {
    if (selIds[src[i].id] && !isBoundText(c)) nextSel[c.id] = true;
  });
  getState().setAppState({ selectedElementIds: nextSel });
}

// ---- select all ----------------------------------------------------------------
function selectAll(s: Store) {
  const eg = s.appState.editingGroupId;
  const ids: Record<string, true> = {};
  const frames = new Set<string>();
  for (const el of s.elements) {
    if (el.isDeleted || el.locked || isBoundText(el)) continue;
    if (eg && !el.groupIds.includes(eg)) continue;
    if (el.type === "frame") frames.add(el.id);
  }
  for (const el of s.elements) {
    if (el.isDeleted || el.locked || isBoundText(el)) continue;
    if (eg && !el.groupIds.includes(eg)) continue;
    if (el.frameId && frames.has(el.frameId)) continue; // moves with its frame
    ids[el.id] = true;
  }
  s.setAppState({ selectedElementIds: ids, activeTool: "selection" });
}

// ---- copy / paste styles -------------------------------------------------------
type StyleSnapshot = {
  base: Partial<ExcalidrawElement>;
  text?: Partial<TextElement>;
  arrow?: Record<string, unknown>;
};
let copiedStyle: StyleSnapshot | null = null;

function copyStyles(s: Store) {
  const sel = getSelectedElements(s).filter((e) => !isBoundText(e));
  const el = sel[0];
  if (!el) return;
  const map = byId(s.elements);
  const label = isText(el) ? el : getBoundText(el, map);
  copiedStyle = {
    base: {
      strokeColor: el.strokeColor,
      backgroundColor: el.backgroundColor,
      fillStyle: el.fillStyle,
      strokeWidth: el.strokeWidth,
      strokeStyle: el.strokeStyle,
      roughness: el.roughness,
      roundness: el.roundness,
      opacity: el.opacity,
    },
    text: label
      ? { fontSize: label.fontSize, fontFamily: label.fontFamily, textAlign: label.textAlign, strokeColor: label.strokeColor }
      : undefined,
    arrow:
      el.type === "arrow"
        ? { startArrowhead: el.startArrowhead, endArrowhead: el.endArrowhead, arrowType: el.arrowType }
        : undefined,
  };
  s.setAppState({ toast: { message: "Styles copied", kind: "success" } });
}

function pasteStyles(s: Store) {
  const st = copiedStyle;
  if (!st) return;
  const targets = styleTargets(s);
  if (!targets.length) return;
  const map = byId(s.elements);
  s.recordHistory();
  const patches: Record<string, Partial<ExcalidrawElement>> = {};
  const texts: TextElement[] = [];
  for (const el of targets) {
    if (isText(el)) {
      patches[el.id] = measureFreeText(el, { ...(st.text ?? {}), opacity: st.base.opacity, strokeColor: st.text?.strokeColor ?? st.base.strokeColor }) as Partial<ExcalidrawElement>;
      texts.push(el);
      continue;
    }
    let p: Partial<ExcalidrawElement> = { ...st.base };
    if (el.type === "image") p = { opacity: st.base.opacity, roundness: st.base.roundness };
    if (el.type === "arrow" && st.arrow) p = { ...p, ...(st.arrow as Partial<ExcalidrawElement>) };
    patches[el.id] = p;
    const label = getBoundText(el, map);
    if (label && st.text) {
      const { textAlign: _ignored, ...rest } = st.text;
      void _ignored;
      patches[label.id] = measureFreeText(label, { ...rest, opacity: st.base.opacity }) as Partial<ExcalidrawElement>;
      texts.push(label);
    }
  }
  s.mutateElements(patches);
  let els = getState().elements;
  for (const t of texts) els = refreshTextLayout(els, t.containerId ?? t.id);
  getState().setElements(updateBoundElements(els, Object.keys(patches)));
}

// ---- grouping ------------------------------------------------------------------
function groupable(s: Store) {
  return editableSelection(s).filter((e) => !isBoundText(e) && e.type !== "frame");
}

function canGroup(s: Store) {
  if (!canEdit(s)) return false;
  const sel = groupable(s);
  return sel.length > 1 && getUnits(sel, s.elements, s.appState.editingGroupId).length > 1;
}

function group(s: Store) {
  const sel = groupable(s);
  const eg = s.appState.editingGroupId;
  if (getUnits(sel, s.elements, eg).length < 2) return;
  const gid = newGroupId();
  const members = expandSelection(sel, s.elements, { boundText: true, frameChildren: false });
  const memberIds = new Set(members.map((m) => m.id));
  s.recordHistory();
  const patches: Record<string, Partial<ExcalidrawElement>> = {};
  for (const m of members) {
    const g = [...m.groupIds];
    const i = eg ? g.indexOf(eg) : -1;
    if (i >= 0) g.splice(i, 0, gid);
    else g.push(gid);
    patches[m.id] = { groupIds: g };
  }
  s.mutateElements(patches);
  // make the group contiguous in z-order, at the position of its topmost member
  const els = getState().elements;
  const top = Math.max(...els.map((e, i) => (memberIds.has(e.id) ? i : -1)));
  const grouped = els.filter((e) => memberIds.has(e.id));
  const before = els.slice(0, top + 1).filter((e) => !memberIds.has(e.id));
  const after = els.slice(top + 1);
  getState().setElements([...before, ...grouped, ...after]);
}

function canUngroup(s: Store) {
  if (!canEdit(s)) return false;
  const eg = s.appState.editingGroupId;
  return editableSelection(s).some((e) => unitGroupId(e, eg) !== null);
}

function ungroup(s: Store) {
  const eg = s.appState.editingGroupId;
  const sel = editableSelection(s).filter((e) => !isBoundText(e));
  const members = expandSelection(sel, s.elements, { boundText: true, frameChildren: false });
  const patches: Record<string, Partial<ExcalidrawElement>> = {};
  const map = byId(s.elements);
  for (const m of members) {
    const owner = isBoundText(m) ? (map.get(m.containerId!) ?? m) : m;
    const gid = unitGroupId(owner, eg);
    if (gid) patches[m.id] = { groupIds: m.groupIds.filter((g) => g !== gid) };
  }
  if (!Object.keys(patches).length) return;
  s.recordHistory();
  s.mutateElements(patches);
}

// ---- lock ---------------------------------------------------------------------
function toggleLock(s: Store) {
  const sel = expandSelection(getSelectedElements(s), s.elements);
  if (!sel.length) return;
  const lock = !sel.filter((e) => !isBoundText(e)).every((e) => e.locked);
  s.recordHistory();
  const patches: Record<string, Partial<ExcalidrawElement>> = {};
  for (const e of sel) patches[e.id] = { locked: lock };
  s.mutateElements(patches);
  s.setAppState({ toast: { message: lock ? "Locked — unlock from the context menu or Ctrl/⌘+Shift+L" : "Unlocked", kind: "info" } });
}

function unlockAll(s: Store) {
  const locked = s.elements.filter((e) => !e.isDeleted && e.locked);
  if (!locked.length) return;
  s.recordHistory();
  const patches: Record<string, Partial<ExcalidrawElement>> = {};
  const sel: Record<string, true> = {};
  for (const e of locked) {
    patches[e.id] = { locked: false };
    if (!isBoundText(e)) sel[e.id] = true;
  }
  s.mutateElements(patches);
  s.setAppState({ selectedElementIds: sel, activeTool: "selection" });
}

// ---- frames -----------------------------------------------------------------------
function wrapInFrame(s: Store) {
  const sel = editableSelection(s).filter((e) => e.type !== "frame" && !isBoundText(e));
  if (!sel.length) return;
  const members = expandSelection(sel, s.elements, { boundText: true, frameChildren: false });
  const [x1, y1, x2, y2] = getCommonBounds(members);
  const pad = 16;
  const frame = newFrame({ x: x1 - pad, y: y1 - pad, width: x2 - x1 + pad * 2, height: y2 - y1 + pad * 2 });
  s.recordHistory();
  const patches: Record<string, Partial<ExcalidrawElement>> = {};
  for (const m of members) patches[m.id] = { frameId: frame.id };
  s.mutateElements(patches);
  const els = getState().elements;
  const ids = new Set(members.map((m) => m.id));
  const minIdx = els.findIndex((e) => ids.has(e.id));
  getState().setElements([...els.slice(0, minIdx), frame, ...els.slice(minIdx)]);
  getState().setAppState({ selectedElementIds: { [frame.id]: true } });
}

// ---- shape conversion ---------------------------------------------------------------
export function convertSelection(type: ShapeType) {
  const s = getState();
  const targets = styleTargets(s).filter(isShape);
  if (!targets.length) return;
  s.recordHistory();
  const patches: Record<string, Partial<ExcalidrawElement>> = {};
  for (const el of targets) if (el.type !== type) patches[el.id] = { type } as Partial<ExcalidrawElement>;
  const ids = Object.keys(patches);
  if (!ids.length) return;
  s.mutateElements(patches);
  let els = getState().elements;
  for (const id of ids) els = refreshTextLayout(els, id);
  getState().setElements(updateBoundElements(els, ids));
}

const canConvert = (s: Store, type: ShapeType) => {
  if (!canEdit(s)) return false;
  const t = styleTargets(s);
  return t.length > 0 && t.every(isShape) && t.some((e) => e.type !== type);
};

export const shapeLabel = (t: string) => t[0].toUpperCase() + t.slice(1);

// ---- escape ----------------------------------------------------------------------------
function escapeAction(s: Store) {
  const as = s.appState;
  if (as.contextMenu || as.openMenu) return s.setAppState({ contextMenu: null, openMenu: null });
  if (as.croppingImageId) return s.setAppState({ croppingImageId: null });
  if (as.editingLinearId) return s.setAppState({ editingLinearId: null });
  if (as.editingGroupId) {
    const eg = as.editingGroupId;
    const members = s.elements.filter((e) => !e.isDeleted && e.groupIds.includes(eg));
    const sample = members[0];
    const i = sample ? sample.groupIds.indexOf(eg) : -1;
    const parent = sample && i >= 0 ? (sample.groupIds[i + 1] ?? null) : null;
    const sel: Record<string, true> = {};
    for (const m of members) if (!isBoundText(m)) sel[m.id] = true;
    return s.setAppState({ editingGroupId: parent, selectedElementIds: sel });
  }
  if (hasSelection(s)) return s.setAppState({ selectedElementIds: {} });
  if (as.activeTool !== "selection") setTool("selection");
}

const escapeHasWork = (s: Store) => {
  const as = s.appState;
  return !!(
    as.contextMenu ||
    as.openMenu ||
    as.croppingImageId ||
    as.editingLinearId ||
    as.editingGroupId ||
    hasSelection(s) ||
    as.activeTool !== "selection"
  );
};

// ---- registration ------------------------------------------------------------------
const actions: Action[] = [
  {
    id: "edit.cut",
    label: "Cut",
    category: "editor",
    keywords: ["clipboard"],
    predicate: editableHasSel,
    perform: () => void cutSelection(),
    contextMenu: "element",
  },
  {
    id: "edit.copy",
    label: "Copy",
    category: "editor",
    keywords: ["clipboard"],
    predicate: hasSelection,
    perform: () => void copySelection(),
    contextMenu: "element",
  },
  {
    id: "edit.paste",
    label: "Paste",
    category: "editor",
    keywords: ["clipboard"],
    predicate: canEdit,
    perform: () => void pasteFromClipboard(),
    contextMenu: "both",
  },
  {
    id: "edit.selectAll",
    label: "Select all",
    category: "editor",
    shortcuts: ["Mod+A"],
    predicate: (s) => s.elements.some((e) => !e.isDeleted && !e.locked),
    perform: selectAll,
    contextMenu: "canvas",
  },
  {
    id: "edit.copyStyles",
    label: "Copy styles",
    category: "element",
    shortcuts: ["Mod+Alt+C"],
    predicate: hasSelection,
    perform: copyStyles,
    contextMenu: "element",
  },
  {
    id: "edit.pasteStyles",
    label: "Paste styles",
    category: "element",
    shortcuts: ["Mod+Alt+V"],
    predicate: (s) => !!copiedStyle && editableHasSel(s),
    perform: pasteStyles,
    contextMenu: "element",
  },
  {
    id: "edit.group",
    label: "Group selection",
    category: "element",
    shortcuts: ["Mod+G"],
    predicate: canGroup,
    perform: group,
    contextMenu: "element",
  },
  {
    id: "edit.ungroup",
    label: "Ungroup selection",
    category: "element",
    shortcuts: ["Mod+Shift+G"],
    predicate: canUngroup,
    perform: ungroup,
    contextMenu: "element",
  },
  {
    id: "frame.wrapSelection",
    label: "Wrap selection in frame",
    category: "element",
    keywords: ["frame", "artboard"],
    predicate: (s) => canEdit(s) && editableSelection(s).some((e) => e.type !== "frame" && !isBoundText(e)),
    perform: wrapInFrame,
    contextMenu: "element",
  },
  {
    id: "edit.link",
    label: "Add / edit link",
    category: "element",
    keywords: ["hyperlink", "url"],
    shortcuts: ["Mod+K"],
    predicate: (s) => canEdit(s) && getSelectedElements(s).filter((e) => !isBoundText(e)).length === 1,
    perform: (s) => s.setAppState({ openDialog: "link", contextMenu: null }),
    contextMenu: "element",
  },
  {
    id: "edit.lock",
    label: "Lock / unlock",
    category: "element",
    keywords: ["lock", "unlock", "freeze"],
    shortcuts: ["Mod+Shift+L"],
    predicate: (s) => canEdit(s) && hasSelection(s),
    perform: toggleLock,
    contextMenu: "element",
  },
  {
    id: "edit.unlockAll",
    label: "Unlock all elements",
    category: "element",
    predicate: (s) => canEdit(s) && s.elements.some((e) => !e.isDeleted && e.locked),
    perform: unlockAll,
    contextMenu: "canvas",
  },
  {
    id: "edit.editText",
    label: "Edit text",
    category: "element",
    keywords: ["label", "write"],
    shortcuts: ["Enter"],
    predicate: (s) => {
      if (!canEdit(s)) return false;
      const sel = getSelectedElements(s).filter((e) => !isBoundText(e));
      return sel.length === 1 && !sel[0].locked && (isText(sel[0]) || isShape(sel[0]) || sel[0].type === "arrow");
    },
    perform: (s) => {
      const el = getSelectedElements(s).find((e) => !isBoundText(e));
      if (el) startTextEditing(el.id);
    },
  },
  {
    id: "edit.duplicate",
    label: "Duplicate",
    category: "element",
    shortcuts: ["Mod+D"],
    predicate: editableHasSel,
    perform: duplicate,
    contextMenu: "element",
  },
  {
    id: "edit.delete",
    label: "Delete",
    category: "element",
    keywords: ["remove", "erase"],
    shortcuts: ["Delete", "Backspace"],
    predicate: editableHasSel,
    perform: () => deleteSelection(),
    contextMenu: "element",
  },
  {
    id: "edit.undo",
    label: "Undo",
    category: "editor",
    shortcuts: ["Mod+Z"],
    predicate: (s) => canEdit(s) && s.undoStack.length > 0,
    perform: (s) => s.undo(),
  },
  {
    id: "edit.redo",
    label: "Redo",
    category: "editor",
    shortcuts: ["Mod+Shift+Z", "Mod+Y"],
    predicate: (s) => canEdit(s) && s.redoStack.length > 0,
    perform: (s) => s.redo(),
  },
  {
    id: "edit.clearCanvas",
    label: "Reset the canvas",
    category: "editor",
    keywords: ["clear", "delete all", "new"],
    predicate: (s) => canEdit(s) && s.elements.some((e) => !e.isDeleted),
    perform: (s) => s.setAppState({ openDialog: "clear-canvas", openMenu: null }),
  },
  {
    id: "ui.escape",
    label: "Deselect / exit",
    category: "editor",
    shortcuts: ["Escape"],
    palette: false,
    predicate: escapeHasWork,
    perform: escapeAction,
  },
  ...SHAPE_TYPES.map(
    (t): Action => ({
      id: `convert.${t}`,
      label: `Convert to ${t}`,
      category: "element",
      keywords: ["convert", "change shape", "switch", t],
      predicate: (s) => canConvert(s, t),
      perform: () => convertSelection(t),
    }),
  ),
];

registerActions(actions);

export const hasCopiedStyle = () => !!copiedStyle;
