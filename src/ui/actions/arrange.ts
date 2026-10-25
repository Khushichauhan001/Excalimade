import { registerActions, type Action } from "../../core/actions";
import { getSelectedElements, getState, type Store } from "../../core/store";
import { getCommonBounds, getElementAbsCoords, hasPoints } from "../../core/geometry";
import type { Binding, ExcalidrawElement, Point } from "../../core/types";
import {
  byId,
  canEdit,
  commitPatches,
  editableSelection,
  expandSelection,
  getUnits,
  isBoundText,
  unitBounds,
  unitGroupId,
} from "../lib/scene";

// ---- align & distribute -------------------------------------------------------------
type Edge = "left" | "centerH" | "right" | "top" | "centerV" | "bottom";

const selectionUnits = (s: Store) => getUnits(editableSelection(s), s.elements, s.appState.editingGroupId);

function align(s: Store, edge: Edge) {
  const units = selectionUnits(s);
  if (units.length < 2) return;
  const [x1, y1, x2, y2] = getCommonBounds(units.flat().filter((e) => !isBoundText(e)));
  const patches: Record<string, Partial<ExcalidrawElement>> = {};
  for (const unit of units) {
    const [ux1, uy1, ux2, uy2] = unitBounds(unit);
    let dx = 0;
    let dy = 0;
    if (edge === "left") dx = x1 - ux1;
    else if (edge === "right") dx = x2 - ux2;
    else if (edge === "centerH") dx = (x1 + x2) / 2 - (ux1 + ux2) / 2;
    else if (edge === "top") dy = y1 - uy1;
    else if (edge === "bottom") dy = y2 - uy2;
    else dy = (y1 + y2) / 2 - (uy1 + uy2) / 2;
    if (!dx && !dy) continue;
    for (const m of unit) patches[m.id] = { x: m.x + dx, y: m.y + dy };
  }
  if (!Object.keys(patches).length) return;
  s.recordHistory();
  commitPatches(patches);
}

function distribute(s: Store, axis: "x" | "y") {
  const units = selectionUnits(s);
  if (units.length < 3) return;
  const lo = axis === "x" ? 0 : 1;
  const hi = axis === "x" ? 2 : 3;
  const boxes = units
    .map((u) => ({ u, b: unitBounds(u) }))
    .sort((a, b) => (a.b[lo] + a.b[hi]) / 2 - (b.b[lo] + b.b[hi]) / 2);
  const start = Math.min(...boxes.map((x) => x.b[lo]));
  const end = Math.max(...boxes.map((x) => x.b[hi]));
  const total = boxes.reduce((acc, x) => acc + (x.b[hi] - x.b[lo]), 0);
  const gap = (end - start - total) / (boxes.length - 1);
  let pos = start;
  const patches: Record<string, Partial<ExcalidrawElement>> = {};
  for (const { u, b } of boxes) {
    const d = pos - b[lo];
    pos += b[hi] - b[lo] + gap;
    if (Math.abs(d) < 1e-6) continue;
    for (const m of u) patches[m.id] = axis === "x" ? { x: m.x + d } : { y: m.y + d };
  }
  if (!Object.keys(patches).length) return;
  s.recordHistory();
  commitPatches(patches);
}

// ---- flip ---------------------------------------------------------------------------
const TAU = Math.PI * 2;
const normAngle = (a: number) => ((a % TAU) + TAU) % TAU;

function flip(s: Store, dir: "h" | "v") {
  const sel = editableSelection(s);
  if (!sel.length) return;
  const els = expandSelection(sel, s.elements).filter((e) => !isBoundText(e));
  const ids = new Set(els.map((e) => e.id));
  const [x1, y1, x2, y2] = getCommonBounds(els);
  const patches: Record<string, Partial<ExcalidrawElement>> = {};
  const mirrorBinding = (b: Binding | null): Binding | null => {
    if (!b || !b.fixedPoint || !ids.has(b.elementId)) return b;
    const [fx, fy] = b.fixedPoint;
    return { ...b, fixedPoint: dir === "h" ? [1 - fx, fy] : [fx, 1 - fy] };
  };
  for (const el of els) {
    const angle = el.angle ? normAngle(-el.angle) : 0;
    if (hasPoints(el)) {
      const points = el.points.map(([px, py]) => (dir === "h" ? [-px, py] : [px, -py]) as Point);
      const patch: Record<string, unknown> = {
        points,
        angle,
        x: dir === "h" ? x1 + x2 - el.x : el.x,
        y: dir === "v" ? y1 + y2 - el.y : el.y,
      };
      if (el.type === "arrow" || el.type === "line") {
        patch.startBinding = mirrorBinding(el.startBinding);
        patch.endBinding = mirrorBinding(el.endBinding);
      }
      patches[el.id] = patch as Partial<ExcalidrawElement>;
      continue;
    }
    const [ax1, ay1, ax2, ay2] = getElementAbsCoords(el);
    const patch: Record<string, unknown> = {
      angle,
      x: dir === "h" ? el.x + (x1 + x2 - ax2 - ax1) : el.x,
      y: dir === "v" ? el.y + (y1 + y2 - ay2 - ay1) : el.y,
    };
    if (el.type === "image") {
      const [sx, sy] = el.scale ?? [1, 1];
      patch.scale = dir === "h" ? [-sx, sy] : [sx, -sy];
    }
    patches[el.id] = patch as Partial<ExcalidrawElement>;
  }
  s.recordHistory();
  commitPatches(patches);
}

// ---- z-order ---------------------------------------------------------------------------
type Unit = { key: string; els: ExcalidrawElement[]; sel: boolean; deleted: boolean };

function layerSelection(s: Store) {
  const sel = getSelectedElements(s).filter((e) => !e.locked);
  return new Set(expandSelection(sel, s.elements).map((e) => e.id));
}

function moveToEdge(s: Store, edge: "front" | "back") {
  const selIds = layerSelection(s);
  if (!selIds.size) return;
  const all = s.elements;
  const selected = all.filter((e) => selIds.has(e.id));
  const others = all.filter((e) => !selIds.has(e.id));
  const eg = s.appState.editingGroupId;
  let next: ExcalidrawElement[];
  if (eg) {
    // stay within the range of the group being edited
    const groupIdx = others.map((e, i) => (e.groupIds.includes(eg) ? i : -1)).filter((i) => i >= 0);
    if (!groupIdx.length) next = edge === "front" ? [...others, ...selected] : [...selected, ...others];
    else {
      const at = edge === "front" ? groupIdx[groupIdx.length - 1] + 1 : groupIdx[0];
      next = [...others.slice(0, at), ...selected, ...others.slice(at)];
    }
  } else next = edge === "front" ? [...others, ...selected] : [...selected, ...others];
  if (next.every((e, i) => e === all[i])) return;
  s.recordHistory();
  getState().setElements(next);
}

function moveOneStep(s: Store, dir: 1 | -1) {
  const selIds = layerSelection(s);
  if (!selIds.size) return;
  const all = s.elements;
  const map = byId(all);
  const eg = s.appState.editingGroupId;
  const keyOf = (el: ExcalidrawElement): string => {
    if (selIds.has(el.id)) return "\u0000sel";
    if (isBoundText(el)) {
      const c = map.get(el.containerId!);
      if (c) return keyOf(c);
    }
    return unitGroupId(el, eg) ?? el.id;
  };
  const units: Unit[] = [];
  for (const el of all) {
    const key = keyOf(el);
    const last = units[units.length - 1];
    if (last && last.key === key) last.els.push(el);
    else units.push({ key, els: [el], sel: key === "\u0000sel", deleted: false });
  }
  for (const u of units) u.deleted = u.els.every((e) => e.isDeleted);
  const inScope = (u: Unit) => !eg || u.els.some((e) => e.groupIds.includes(eg));
  let changed = false;
  if (dir === 1) {
    for (let i = units.length - 2; i >= 0; i--) {
      if (!units[i].sel) continue;
      let k = i + 1;
      while (k < units.length && units[k].deleted && !units[k].sel) k++;
      if (k >= units.length || units[k].sel || !inScope(units[k])) continue;
      const [u] = units.splice(i, 1);
      units.splice(k, 0, u);
      changed = true;
    }
  } else {
    for (let i = 1; i < units.length; i++) {
      if (!units[i].sel) continue;
      let k = i - 1;
      while (k >= 0 && units[k].deleted && !units[k].sel) k--;
      if (k < 0 || units[k].sel || !inScope(units[k])) continue;
      const [u] = units.splice(i, 1);
      units.splice(k, 0, u);
      changed = true;
    }
  }
  if (!changed) return;
  s.recordHistory();
  getState().setElements(units.flatMap((u) => u.els));
}

// ---- registration -------------------------------------------------------------------------
const multi = (n: number) => (s: Store) => canEdit(s) && selectionUnits(s).length >= n;
const editSel = (s: Store) => canEdit(s) && editableSelection(s).length > 0;

const ALIGN: { edge: Edge; label: string; shortcuts?: string[] }[] = [
  { edge: "left", label: "Align left", shortcuts: ["Mod+Shift+ArrowLeft"] },
  { edge: "centerH", label: "Center horizontally" },
  { edge: "right", label: "Align right", shortcuts: ["Mod+Shift+ArrowRight"] },
  { edge: "top", label: "Align top", shortcuts: ["Mod+Shift+ArrowUp"] },
  { edge: "centerV", label: "Center vertically" },
  { edge: "bottom", label: "Align bottom", shortcuts: ["Mod+Shift+ArrowDown"] },
];

const actions: Action[] = [
  {
    id: "layer.bringForward",
    label: "Bring forward",
    category: "arrange",
    keywords: ["z-index", "order", "layer", "raise"],
    shortcuts: ["Mod+]"],
    predicate: editSel,
    perform: (s) => moveOneStep(s, 1),
    contextMenu: "element",
  },
  {
    id: "layer.bringToFront",
    label: "Bring to front",
    category: "arrange",
    keywords: ["z-index", "order", "layer", "top"],
    shortcuts: ["Mod+Shift+]"],
    predicate: editSel,
    perform: (s) => moveToEdge(s, "front"),
    contextMenu: "element",
  },
  {
    id: "layer.sendBackward",
    label: "Send backward",
    category: "arrange",
    keywords: ["z-index", "order", "layer", "lower"],
    shortcuts: ["Mod+["],
    predicate: editSel,
    perform: (s) => moveOneStep(s, -1),
    contextMenu: "element",
  },
  {
    id: "layer.sendToBack",
    label: "Send to back",
    category: "arrange",
    keywords: ["z-index", "order", "layer", "bottom"],
    shortcuts: ["Mod+Shift+["],
    predicate: editSel,
    perform: (s) => moveToEdge(s, "back"),
    contextMenu: "element",
  },
  {
    id: "flip.horizontal",
    label: "Flip horizontal",
    category: "arrange",
    keywords: ["mirror"],
    shortcuts: ["Shift+H"],
    predicate: editSel,
    perform: (s) => flip(s, "h"),
    contextMenu: "element",
  },
  {
    id: "flip.vertical",
    label: "Flip vertical",
    category: "arrange",
    keywords: ["mirror"],
    shortcuts: ["Shift+V"],
    predicate: editSel,
    perform: (s) => flip(s, "v"),
    contextMenu: "element",
  },
  ...ALIGN.map(
    (a): Action => ({
      id: `align.${a.edge}`,
      label: a.label,
      category: "arrange",
      keywords: ["align"],
      shortcuts: a.shortcuts,
      predicate: multi(2),
      perform: (s) => align(s, a.edge),
    }),
  ),
  {
    id: "distribute.horizontal",
    label: "Distribute horizontally",
    category: "arrange",
    keywords: ["spacing", "space evenly"],
    shortcuts: ["Alt+H"],
    predicate: multi(3),
    perform: (s) => distribute(s, "x"),
  },
  {
    id: "distribute.vertical",
    label: "Distribute vertically",
    category: "arrange",
    keywords: ["spacing", "space evenly"],
    shortcuts: ["Alt+V"],
    predicate: multi(3),
    perform: (s) => distribute(s, "y"),
  },
];

registerActions(actions);
