import { useEffect } from "react";
import { getActions } from "../../core/actions";
import { getState } from "../../core/store";
import { isInputTarget } from "../../core/utils";
import { eventShortcutCandidates } from "./shortcuts";

/** Dialogs that are non-modal panels: global shortcuts keep working while they're open. */
const NON_MODAL = new Set(["find"]);

let spaceHeld = false;

function releaseSpace() {
  if (!spaceHeld) return;
  spaceHeld = false;
  const { appState, setAppState } = getState();
  if (appState.activeTool === "hand") setAppState({ activeTool: appState.lastActiveTool === "hand" ? "selection" : appState.lastActiveTool });
}

function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing || e.key === "Process") return;
  const s = getState();
  const as = s.appState;
  if (as.presentationMode) return;
  if (isInputTarget(e.target) || as.editingTextId) return;

  // hold Space → temporary hand tool
  if (e.code === "Space" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (as.openDialog && !NON_MODAL.has(as.openDialog)) return;
    e.preventDefault();
    if (!e.repeat && !spaceHeld && as.activeTool !== "hand") {
      spaceHeld = true;
      s.setAppState({ lastActiveTool: as.activeTool, activeTool: "hand" });
    }
    return;
  }

  if (as.openDialog && !NON_MODAL.has(as.openDialog)) return;
  // let focused buttons / menu items handle activation keys natively
  const t = e.target as HTMLElement | null;
  if (e.key === "Enter" && t && t !== document.body && t.closest?.("button, a, [role=menuitem], [role=option], [role=radio]")) return;

  const cands = eventShortcutCandidates(e);
  for (const a of getActions()) {
    if (!a.shortcuts?.some((sc) => cands.includes(sc))) continue;
    if (a.predicate && !a.predicate(s)) continue;
    e.preventDefault();
    e.stopPropagation();
    a.perform(s, "keyboard");
    return;
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === "Space" && spaceHeld) {
    e.preventDefault();
    releaseSpace();
  }
}

/** Installs the single global shortcut listener (keydown) plus Space-to-pan handling. */
export function useGlobalKeyboard() {
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseSpace);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseSpace);
    };
  }, []);
}
