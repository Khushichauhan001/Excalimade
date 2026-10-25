import { useMemo, useSyncExternalStore } from "react";
import { useStore } from "../../core/store";
import { getAction, getActions, subscribeActions } from "../../core/actions";
import type { ExcalidrawElement } from "../../core/types";

// ---- action registry subscription -------------------------------------------
let actionsVersion = 0;
const actionListeners = new Set<() => void>();
subscribeActions(() => {
  actionsVersion++;
  actionListeners.forEach((l) => l());
});
const subscribeRegistry = (cb: () => void) => {
  actionListeners.add(cb);
  return () => void actionListeners.delete(cb);
};

/** Re-renders when actions are (re-)registered. Returns a version number usable as a memo dep. */
export const useActionsVersion = () => useSyncExternalStore(subscribeRegistry, () => actionsVersion);

export const useAction = (id: string) => {
  useActionsVersion();
  return getAction(id);
};

export const useAllActions = () => {
  const v = useActionsVersion();
  return useMemo(() => getActions(), [v]);
};

// ---- scene selectors ------------------------------------------------------
export function useSelectedElements(): ExcalidrawElement[] {
  const elements = useStore((s) => s.elements);
  const sel = useStore((s) => s.appState.selectedElementIds);
  return useMemo(() => elements.filter((e) => !e.isDeleted && sel[e.id]), [elements, sel]);
}

export const useHasElements = () => useStore((s) => s.elements.some((e) => !e.isDeleted));
