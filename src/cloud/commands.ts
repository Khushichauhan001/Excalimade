// Implementation of the registered cloud.* actions (loaded on demand by register.ts).
import { getState, showToast } from "../core/store";
import { cloud, setCloud } from "./session";
import { openModal, signOut, toggleCommentMode } from "./controller";
import type { CloudCommand } from "./register";

export function runCommand(cmd: CloudCommand) {
  const { user, scene } = cloud();
  const st = getState();
  switch (cmd) {
    case "open":
      st.setAppState({ openDialog: st.appState.openDialog === "cloud" ? null : "cloud" });
      return;
    case "saveAs":
      if (!user) {
        setCloud({ pending: { kind: "saveAs" } });
        st.setAppState({ openDialog: "cloud" });
        return;
      }
      openModal({ kind: "saveAs" });
      return;
    case "share":
      if (!user && !scene) {
        setCloud({ pending: { kind: "saveAs" } });
        st.setAppState({ openDialog: "cloud" });
        showToast("Sign in to save and share scenes with Excalimade+");
        return;
      }
      if (!scene) {
        showToast("Save the scene to Excalimade+ first, then share it");
        openModal({ kind: "saveAs" });
        return;
      }
      openModal({ kind: "share" });
      return;
    case "comments":
      toggleCommentMode();
      return;
    case "history":
      if (!scene || !user) {
        showToast("Version history is available for scenes saved to Excalimade+");
        return;
      }
      st.setAppState({ openSidebar: st.appState.openSidebar === "versions" ? null : "versions" });
      return;
    case "signOut":
      void signOut();
      return;
  }
}
