// Scene helpers used by the UI actions and panels. They read/write the store directly.
import { getState, getSelectedElements, type Store } from "../../core/store";
import { updateBoundElements } from "../../core/binding";
import { getCommonBounds, getElementAbsCoords, hasPoints, type Bounds } from "../../core/geometry";
import { measureText, wrapText } from "../../core/text";
import type { ExcalidrawElement, TextElement } from "../../core/types";
import { randomId } from "../../core/utils";
import { SHAPE_TYPES, type ShapeType } from "../../core/types";

export const isText = (el: ExcalidrawElement): el is TextElement => el.type === "text";
export const isBoundText = (el: ExcalidrawElement): el is TextElement => isText(el) && !!el.containerId;
export const isShape = (el: ExcalidrawElement): el is ExcalidrawElement & { type: ShapeType } =>
  (SHAPE_TYPES as string[]).includes(el.type);

export const selectedCount = (s: Store) => getSelectedElements(s).length;
export const hasSelection = (s: Store) => selectedCount(s) > 0;
export const canEdit = (s: Store) => !s.appState.viewModeEnabled;
/** Selected, non-locked elements. */
export const editableSelection = (s: Store = getState()) => getSelectedElements(s).filter((e) => !e.locked);

export function byId(elements: readonly ExcalidrawElement[]) {
  return new Map(elements.map((e) => [e.id, e]));
}

export function getBoundText(container: ExcalidrawElement, map: Map<string, ExcalidrawElement>): TextElement | undefined {
  for (const b of container.boundElements) {
    if (b.type !== "text") continue;
    const t = map.get(b.id);
    if (t && !t.isDeleted && isText(t)) return t;
  }
  return undefined;
}

/** Add bound text labels of containers (and children of frames) to a list, deduped, keeping scene order. */
export function expandSelection(
  els: readonly ExcalidrawElement[],
  all: readonly ExcalidrawElement[],
  opts: { boundText?: boolean; frameChildren?: boolean } = { boundText: true, frameChildren: true },
) {
  const ids = new Set(els.map((e) => e.id));
  const frameIds = new Set(els.filter((e) => e.type === "frame").map((e) => e.id));
  for (const el of all) {
    if (el.isDeleted || ids.has(el.id)) continue;
    if (opts.boundText && isBoundText(el) && ids.has(el.containerId!)) ids.add(el.id);
    if (opts.frameChildren && el.frameId && frameIds.has(el.frameId)) ids.add(el.id);
  }
  // second pass: labels of frame children
  if (opts.boundText)
    for (const el of all) if (!el.isDeleted && isBoundText(el) && ids.has(el.containerId!)) ids.add(el.id);
  return all.filter((e) => ids.has(e.id));
}

/**
 * The group an element moves with, relative to the group currently being edited:
 * the outermost group, or (inside an editing group) the group directly inside it.
 */
export function unitGroupId(el: ExcalidrawElement, editingGroupId: string | null): string | null {
  const g = el.groupIds;
  if (editingGroupId) {
    const i = g.indexOf(editingGroupId);
    if (i >= 0) return i > 0 ? g[i - 1] : null;
  }
  return g.length ? g[g.length - 1] : null;
}

/**
 * Split elements into "units" that move together: elements of the same (relative) group,
 * a frame with its children, a container with its label.
 */
export function getUnits(els: readonly ExcalidrawElement[], all: readonly ExcalidrawElement[], editingGroupId: string | null) {
  const units = new Map<string, ExcalidrawElement[]>();
  const selectedFrames = new Set(els.filter((e) => e.type === "frame").map((e) => e.id));
  for (const el of els) {
    if (isBoundText(el)) continue; // labels follow containers
    const key = unitGroupId(el, editingGroupId) ?? (el.frameId && selectedFrames.has(el.frameId) ? el.frameId : el.id);
    if (!units.has(key)) units.set(key, []);
    units.get(key)!.push(el);
  }
  // pull in frame children and labels so they move with their unit (each element in one unit only)
  const seen = new Set<string>();
  const out: ExcalidrawElement[][] = [];
  for (const members of units.values()) {
    const unit = expandSelection(members, all).filter((e) => !seen.has(e.id));
    unit.forEach((e) => seen.add(e.id));
    if (unit.length) out.push(unit);
  }
  return out;
}

/** Patch elements (bumping versions) then let bound arrows/labels follow. */
export function commitPatches(patches: Record<string, Partial<ExcalidrawElement>>) {
  const s = getState();
  const ids = Object.keys(patches);
  if (!ids.length) return;
  s.mutateElements(patches);
  const after = getState();
  after.setElements(updateBoundElements(after.elements, ids));
}

export const moveElementPatch = (el: ExcalidrawElement, dx: number, dy: number): Partial<ExcalidrawElement> => ({
  x: el.x + dx,
  y: el.y + dy,
});

/** Bounds used for align/distribute/flip: unrotated boxes for point elements are tight, others include rotation. */
export const unitBounds = (unit: readonly ExcalidrawElement[]): Bounds =>
  getCommonBounds(unit.filter((e) => !isBoundText(e)));

export function getSelectionBounds(els: readonly ExcalidrawElement[]): Bounds {
  return getCommonBounds(els.filter((e) => !isBoundText(e)));
}

/** Re-measure a free text element for new font props. Containers' labels are handled by refreshTextLayout. */
export function measureFreeText(t: TextElement, patch: Partial<TextElement>): Partial<TextElement> {
  if (t.containerId) return patch;
  const fontSize = patch.fontSize ?? t.fontSize;
  const fontFamily = patch.fontFamily ?? t.fontFamily;
  const lineHeight = t.lineHeight || 1.25;
  if (t.autoResize !== false) {
    const m = measureText(t.originalText ?? t.text, fontSize, fontFamily, lineHeight);
    const textAlign = patch.textAlign ?? t.textAlign;
    // keep the anchor edge stable depending on alignment
    const dx = textAlign === "center" ? (t.width - m.width) / 2 : textAlign === "right" ? t.width - m.width : 0;
    return { ...patch, width: m.width, height: m.height, x: t.x + dx, text: t.originalText ?? t.text };
  }
  const wrapped = wrapText(t.originalText ?? t.text, fontSize, fontFamily, t.width);
  const m = measureText(wrapped, fontSize, fontFamily, lineHeight);
  return { ...patch, text: wrapped, height: m.height };
}

/** Uniformly/non-uniformly scale an element about an origin (used by the stats panel). */
export function scaleElementPatch(el: ExcalidrawElement, sx: number, sy: number, ox: number, oy: number): Partial<ExcalidrawElement> {
  if (hasPoints(el)) {
    const [ax1, ay1] = getElementAbsCoords(el);
    const points = el.points.map(([px, py]) => [px * sx, py * sy] as [number, number]);
    // keep the bounding box corner anchored relative to the origin
    const minPx = Math.min(...points.map((q) => q[0]));
    const minPy = Math.min(...points.map((q) => q[1]));
    const nx1 = ox + (ax1 - ox) * sx;
    const ny1 = oy + (ay1 - oy) * sy;
    return {
      points,
      x: nx1 - minPx,
      y: ny1 - minPy,
      width: el.width * Math.abs(sx),
      height: el.height * Math.abs(sy),
    } as Partial<ExcalidrawElement>;
  }
  const patch: Partial<ExcalidrawElement> = {
    x: ox + (el.x - ox) * sx,
    y: oy + (el.y - oy) * sy,
    width: Math.max(1, el.width * sx),
    height: Math.max(1, el.height * sy),
  };
  if (isText(el)) {
    const f = sx !== 1 ? sx : sy;
    const fontSize = Math.max(1, Math.round(el.fontSize * f * 10) / 10);
    const m = measureFreeText(el, { fontSize });
    return { ...patch, ...m, x: patch.x, y: patch.y } as Partial<ExcalidrawElement>;
  }
  return patch;
}

/** Elements that would be affected by a style change, with locked ones excluded. */
export function styleTargets(s: Store = getState()) {
  const sel = editableSelection(s);
  const selIds = new Set(sel.map((e) => e.id));
  // bound text whose container is also selected is styled through the container
  return sel.filter((e) => !(isBoundText(e) && selIds.has(e.containerId!)));
}

/** Text elements that font changes apply to: selected text, labels of selected containers, the text being edited. */
export function textTargets(s: Store = getState()): TextElement[] {
  const map = byId(s.elements);
  const out = new Map<string, TextElement>();
  for (const el of styleTargets(s)) {
    if (isText(el)) out.set(el.id, el);
    else {
      const t = getBoundText(el, map);
      if (t) out.set(t.id, t);
    }
  }
  const editing = s.appState.editingTextId ? map.get(s.appState.editingTextId) : undefined;
  if (editing && isText(editing) && !editing.isDeleted) out.set(editing.id, editing);
  return [...out.values()];
}

export const newGroupId = () => randomId();
