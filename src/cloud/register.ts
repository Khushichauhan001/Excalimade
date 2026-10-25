// Eager, tiny: registers the Excalimade+ actions. The heavy implementation loads on demand.
import { registerActions } from "../core/actions";
import { useCloud } from "./session";

export type CloudCommand = "open" | "saveAs" | "share" | "comments" | "history" | "signOut";

const run = (cmd: CloudCommand) => {
  void import("./commands").then((m) => m.runCommand(cmd));
};

const hasScene = () => !!useCloud.getState().scene && !!useCloud.getState().user;

registerActions([
  {
    id: "cloud.open",
    label: "Excalimade+ dashboard",
    category: "collab",
    keywords: ["cloud", "plus", "scenes", "workspace", "team", "sign in", "account", "dashboard"],
    perform: () => run("open"),
  },
  {
    id: "cloud.saveAs",
    label: "Export to Excalimade+",
    category: "export",
    keywords: ["cloud", "save", "upload", "plus", "save as"],
    perform: () => run("saveAs"),
  },
  {
    id: "cloud.share",
    label: "Share cloud scene",
    category: "collab",
    keywords: ["cloud", "link", "permissions", "embed", "access", "invite"],
    perform: () => run("share"),
  },
  {
    id: "cloud.comments",
    label: "Toggle comment mode",
    category: "collab",
    keywords: ["comment", "annotate", "review", "mention", "feedback"],
    shortcuts: ["Alt+C"],
    predicate: hasScene,
    perform: () => run("comments"),
  },
  {
    id: "cloud.history",
    label: "Version history",
    category: "collab",
    keywords: ["versions", "restore", "snapshot", "history", "backup"],
    predicate: hasScene,
    perform: () => run("history"),
  },
  {
    id: "cloud.signOut",
    label: "Sign out of Excalimade+",
    category: "collab",
    keywords: ["logout", "log out", "account"],
    predicate: () => !!useCloud.getState().user,
    perform: () => run("signOut"),
  },
]);
