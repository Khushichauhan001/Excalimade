import type { AppState, ExcalidrawElement, TextElement } from "../core/types";
import { getState } from "../core/store";
import { boundsContain, getElementBounds, type Bounds } from "../core/geometry";

/** The group that a click on `el` selects, honouring the group the user has entered. */
export function getSelectableGroupId(el: ExcalidrawElement, editingGroupId: string | null): string | null {
  if (!el.groupIds.length) return null;
  if (editingGroupId) {
    const idx = el.groupIds.indexOf(editingGroupId);
    if (idx === 0) return null; // directly inside the edited group → the element itself
    if (idx > 0) return el.groupIds[idx - 1];
  }
  return el.groupIds[el.groupIds.length - 1];
}

export const getGroupMembers = (elements: readonly ExcalidrawElement[], groupId: string) =>
  elements.filter((e) => !e.isDeleted && e.groupIds.includes(groupId));

/** Ids selected when clicking `el` (whole group unless inside an entered group). */
export function selectionFor(el: ExcalidrawElement, elements: readonly ExcalidrawElement[], as: Pick<AppState, "editingGroupId">) {
  const gid = getSelectableGroupId(el, as.editingGroupId);
  const ids: Record<string, true> = {};
  if (gid) for (const m of getGroupMembers(elements, gid)) ids[m.id] = true;
  else ids[el.id] = true;
  return ids;
}

/** Expand ids to complete groups (used after box selection). */
export function expandToGroups(ids: Record<string, true>, elements: readonly ExcalidrawElement[], editingGroupId: string | null) {
  const out: Record<string, true> = { ...ids };
  for (const el of elements) {
    if (!ids[el.id]) continue;
    const gid = getSelectableGroupId(el, editingGroupId);
    if (gid) for (const m of getGroupMembers(elements, gid)) out[m.id] = true;
  }
  return out;
}

/** Elements completely inside a scene rectangle (bound text is resolved by the container). */
export function getElementsInBox(elements: readonly ExcalidrawElement[], box: Bounds, editingGroupId: string | null) {
  const ids: Record<string, true> = {};
  for (const el of elements) {
    if (el.isDeleted || el.locked) continue;
    if (el.type === "text" && (el as TextElement).containerId) continue;
    if (editingGroupId && !el.groupIds.includes(editingGroupId)) continue;
    if (boundsContain(box, getElementBounds(el))) ids[el.id] = true;
  }
  // a frame fully selected takes its children along implicitly; don't double-select them
  return expandToGroups(ids, elements, editingGroupId);
}

/**
 * Everything that moves together with the selection: bound text labels and frame children.
 * Returns ids (excluding the selection itself).
 */
export function getDependents(selectedIds: Set<string>, elements: readonly ExcalidrawElement[]) {
  const out = new Set<string>();
  for (const el of elements) {
    if (el.isDeleted || selectedIds.has(el.id)) continue;
    if (el.type === "text" && (el as TextElement).containerId && selectedIds.has((el as TextElement).containerId!)) out.add(el.id);
    else if (el.frameId && selectedIds.has(el.frameId)) {
      out.add(el.id);
    }
  }
  // labels of frame children
  for (const el of elements) {
    if (el.type === "text" && (el as TextElement).containerId && out.has((el as TextElement).containerId!)) out.add(el.id);
  }
  return out;
}

export const selectIds = (ids: Record<string, true>) =>
  getState().setAppState({ selectedElementIds: ids, editingLinearId: null, croppingImageId: null });
