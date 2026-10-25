// Imperative editing commands shared by the pointer controller, keyboard handling and the public api.
import type { ExcalidrawElement, FrameElement, LinearElement, TextElement } from "../core/types";
import { getState, showToast } from "../core/store";
import { newText, bindTextToContainer } from "../core/elements";
import { boundsContain, getElementBounds, isLinear } from "../core/geometry";
import { getBoundText, refreshTextLayout, updateBoundElements, withAbsolutePoints } from "../core/binding";
import { scrollToElements } from "../core/viewport";
import { isShape } from "../render/shapes";
import { randomInteger } from "../core/utils";
import { session } from "./session";

const bumped = <T extends ExcalidrawElement>(el: T, patch: Partial<T>): T =>
  ({ ...el, ...patch, version: el.version + 1, versionNonce: randomInteger(), updated: Date.now() }) as T;

/** Soft-delete ids plus dependents and clean dangling references. Returns the new element list. */
export function deleteElementsFrom(elements: ExcalidrawElement[], ids: Set<string>): ExcalidrawElement[] {
  const del = new Set(ids);
  for (const el of elements) {
    if (el.isDeleted) continue;
    if (el.type === "text" && (el as TextElement).containerId && del.has((el as TextElement).containerId!)) del.add(el.id);
    if (el.frameId && del.has(el.frameId)) del.add(el.id);
  }
  // second pass for labels of frame children
  for (const el of elements) if (el.type === "text" && (el as TextElement).containerId && del.has((el as TextElement).containerId!)) del.add(el.id);
  let next = elements.map((el) => {
    if (del.has(el.id)) return el.isDeleted ? el : bumped(el, { isDeleted: true, boundElements: [] });
    let changed = false;
    const patch: any = {};
    if (el.boundElements.some((b) => del.has(b.id))) {
      patch.boundElements = el.boundElements.filter((b) => !del.has(b.id));
      changed = true;
    }
    if (isLinear(el)) {
      if (el.startBinding && del.has(el.startBinding.elementId)) { patch.startBinding = null; changed = true; }
      if (el.endBinding && del.has(el.endBinding.elementId)) { patch.endBinding = null; changed = true; }
    }
    return changed ? bumped(el, patch) : el;
  });
  next = next.map((el) => (el.type === "text" && (el as TextElement).containerId && del.has((el as TextElement).containerId!) ? el : el));
  return next;
}

export function deleteSelectionImpl() {
  const s = getState();
  const as = s.appState;
  if (as.viewModeEnabled) return;
  // linear editor: delete selected points
  if (as.editingLinearId && session.linearSelectedPoints.length) {
    const el = s.elements.find((e) => e.id === as.editingLinearId) as LinearElement | undefined;
    if (el && el.points.length - session.linearSelectedPoints.length >= 2) {
      s.recordHistory();
      const abs = el.points.filter((_, i) => !session.linearSelectedPoints.includes(i)).map(([px, py]) => [el.x + px, el.y + py] as [number, number]);
      const updated = withAbsolutePoints({ ...el, polygon: el.polygon && abs.length > 2 }, abs);
      session.linearSelectedPoints = [];
      s.setElements(updateBoundElements(s.elements.map((e) => (e.id === el.id ? updated : e)), [el.id]));
      return;
    }
  }
  const ids = new Set(Object.keys(as.selectedElementIds).filter((id) => {
    const el = s.elements.find((e) => e.id === id);
    return el && !el.locked;
  }));
  if (!ids.size) return;
  s.recordHistory();
  s.setElements(deleteElementsFrom(s.elements, ids));
  s.setAppState({ selectedElementIds: {}, editingLinearId: null, croppingImageId: null, editingGroupId: null });
}

/** Assign frame membership for the given elements based on full containment. */
export function updateFrameMembership(elements: ExcalidrawElement[], ids: Iterable<string>): ExcalidrawElement[] {
  const frames = elements.filter((e) => e.type === "frame" && !e.isDeleted) as FrameElement[];
  const idSet = new Set(ids);
  const byId = new Map(elements.map((e) => [e.id, e]));
  return elements.map((el) => {
    if (!idSet.has(el.id) || el.type === "frame" || el.isDeleted) return el;
    if (el.type === "text" && (el as TextElement).containerId) {
      const c = byId.get((el as TextElement).containerId!);
      const fid = c?.frameId ?? null;
      return fid === el.frameId ? el : bumped(el, { frameId: fid });
    }
    const b = getElementBounds(el);
    let target: string | null = null;
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i];
      if (boundsContain([f.x, f.y, f.x + f.width, f.y + f.height], b)) {
        target = f.id;
        break;
      }
    }
    // grouped elements: keep membership consistent if any member stays in its frame
    return target === el.frameId ? el : bumped(el, { frameId: target });
  });
}

/** Open the inline text editor for a text element or a container (creating its label if needed). */
export function startTextEditingImpl(elementId: string) {
  const s = getState();
  const el = s.elements.find((e) => e.id === elementId && !e.isDeleted);
  if (!el || s.appState.viewModeEnabled || el.locked) return;
  if (el.type === "frame") {
    s.setAppState({ editingFrameNameId: el.id });
    return;
  }
  if (el.type === "text") {
    s.recordHistory();
    s.setAppState({ editingTextId: el.id, selectedElementIds: { [(el as TextElement).containerId ?? el.id]: true } });
    return;
  }
  if (!isShape(el) && el.type !== "arrow") return;
  const existing = getBoundText(el, s.elements);
  s.recordHistory();
  if (existing) {
    s.setAppState({ editingTextId: existing.id, selectedElementIds: { [el.id]: true } });
    return;
  }
  const as = s.appState;
  const text = newText({
    text: "",
    containerId: el.id,
    strokeColor: el.strokeColor,
    opacity: el.opacity,
    fontFamily: as.currentItemFontFamily,
    fontSize: as.currentItemFontSize,
    groupIds: el.groupIds,
    frameId: el.frameId,
  });
  const container = { ...el };
  bindTextToContainer(container, text);
  // label goes directly above its container in z-order
  const idx = s.elements.findIndex((e) => e.id === el.id);
  const next = [...s.elements];
  next[idx] = bumped(container, {});
  next.splice(idx + 1, 0, text);
  s.setElements(refreshTextLayout(next, text.id));
  s.setAppState({ editingTextId: text.id, selectedElementIds: { [el.id]: true } });
}

export function followLinkImpl(link: string) {
  const m = link.match(/[#?&]element=([\w-]+)/);
  if (m && (link.startsWith("#") || link.startsWith(location.origin) || link.startsWith("?"))) {
    const s = getState();
    const target = s.elements.find((e) => e.id === m[1] && !e.isDeleted);
    if (!target) return showToast("Linked element not found", "error");
    const group = target.groupIds.length ? s.elements.filter((e) => !e.isDeleted && e.groupIds.includes(target.groupIds[target.groupIds.length - 1])) : [target];
    const sel: Record<string, true> = {};
    for (const e of group) sel[e.id] = true;
    s.setAppState({ selectedElementIds: sel });
    scrollToElements(group, true);
    return;
  }
  let url = link.trim();
  if (!/^[a-z][\w+.-]*:/i.test(url)) url = "https://" + url;
  if (/^javascript:/i.test(url)) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
