// Applying style changes to the selection and the current-item defaults.
import { getState } from "../../core/store";
import { refreshTextLayout, updateBoundElements } from "../../core/binding";
import type { AppState, ExcalidrawElement, TextElement } from "../../core/types";
import { byId, getBoundText, isText, measureFreeText, styleTargets, textTargets } from "./scene";

type Patch = Partial<ExcalidrawElement> & Record<string, unknown>;

/**
 * Apply a style change: updates `currentItem*` defaults and every selected (unlocked) element
 * for which `patchFor` returns a patch. `boundText` also styles the labels of selected containers.
 */
export function applyStyle(
  patchFor: (el: ExcalidrawElement) => Patch | null,
  appPatch: Partial<AppState>,
  opts: { boundText?: boolean; history?: boolean; relayoutIds?: boolean } = {},
) {
  const s = getState();
  if (Object.keys(appPatch).length) s.setAppState(appPatch);
  const targets = styleTargets(s);
  if (!targets.length) return;
  const map = byId(s.elements);
  const patches: Record<string, Patch> = {};
  for (const el of targets) {
    const p = patchFor(el);
    if (p) patches[el.id] = p;
    if (opts.boundText && !isText(el)) {
      const t = getBoundText(el, map);
      if (t) {
        const tp = patchFor(t);
        if (tp) patches[t.id] = tp;
      }
    }
  }
  const ids = Object.keys(patches);
  if (!ids.length) return;
  if (opts.history !== false) s.recordHistory();
  s.mutateElements(patches as Record<string, Partial<ExcalidrawElement>>);
  if (opts.relayoutIds) {
    const after = getState();
    after.setElements(updateBoundElements(after.elements, ids));
  }
}

/** Apply font props to text targets (selected text, labels of selected containers, text being edited). */
export function applyTextStyle(patch: Partial<TextElement>, appPatch: Partial<AppState>) {
  const s = getState();
  if (Object.keys(appPatch).length) s.setAppState(appPatch);
  const texts = textTargets(s).filter((t) => !t.locked);
  if (!texts.length) return;
  s.recordHistory();
  const patches: Record<string, Partial<ExcalidrawElement>> = {};
  for (const t of texts) patches[t.id] = measureFreeText(t, patch) as Partial<ExcalidrawElement>;
  s.mutateElements(patches);
  let els = getState().elements;
  const changed = new Set<string>();
  for (const t of texts) {
    els = refreshTextLayout(els, t.containerId ?? t.id);
    changed.add(t.id);
    if (t.containerId) changed.add(t.containerId);
  }
  getState().setElements(updateBoundElements(els, changed));
}

/** Value shared by all items, `undefined` when mixed, `fallback` when the list is empty. */
export function common<T>(values: T[], fallback: T): T | undefined {
  if (!values.length) return fallback;
  const first = values[0];
  return values.every((v) => v === first) ? first : undefined;
}
