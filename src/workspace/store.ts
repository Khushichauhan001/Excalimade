// Workspace state (scene tree, active scene, expanded folders) and the operations the sidebar uses.
import { create } from "zustand";
import { getState, showToast } from "../core/store";
import { debounce } from "../core/utils";
import { getInitialMeta, readSceneWithFiles, switchScene, writeSceneWithFiles, getActiveSceneId } from "../io/autosave";
import type { RestoredScene } from "../io/serialize";
import { parseScene } from "../io/serialize";
import { repo } from "./repo";
import {
  byId,
  childrenOf,
  createNode,
  deleteNode,
  duplicateNode,
  firstScene,
  moveNode,
  newId,
  renameNode,
  type TreeNode,
} from "./tree";

const SIDEBAR_KEY = "excalimade-scenes-sidebar";

interface WorkspaceState {
  ready: boolean;
  nodes: TreeNode[];
  activeId: string | null;
  expanded: Set<string>;
  sidebarOpen: boolean;
  /** Node currently being renamed inline in the sidebar. */
  renamingId: string | null;
}

export const useWorkspace = create<WorkspaceState>(() => ({
  ready: false,
  nodes: [],
  activeId: null,
  expanded: new Set(),
  sidebarOpen: (() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) !== "0" && window.innerWidth >= 1100;
    } catch {
      return false;
    }
  })(),
  renamingId: null,
}));

const ws = () => useWorkspace.getState();
const set = (patch: Partial<WorkspaceState>) => useWorkspace.setState(patch);

const persist = debounce(() => {
  const { nodes, activeId, expanded, ready } = ws();
  if (!ready || !activeId) return;
  void repo.saveMeta({ version: 1, nodes, activeId, expanded: [...expanded] }).catch((e) => console.warn("Workspace save failed", e));
}, 300);

function commit(patch: Partial<WorkspaceState>) {
  set(patch);
  persist();
}

let initPromise: Promise<void> | null = null;
export function initWorkspace() {
  return (initPromise ??= getInitialMeta().then((meta) => {
    set({ ready: true, nodes: meta.nodes, activeId: meta.activeId, expanded: new Set(meta.expanded) });
    const active = byId(meta.nodes, meta.activeId);
    if (active && !getState().appState.name) getState().setAppState({ name: active.title });
  }));
}

/** Serialise tree changes with scene switches so rapid clicks never interleave. */
let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(fn: () => Promise<T>) => (queue = queue.then(fn, fn)) as Promise<T>;

export const setSidebarOpen = (open: boolean) => {
  set({ sidebarOpen: open });
  try {
    localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
};

export function openScene(id: string) {
  return enqueue(async () => {
    const node = byId(ws().nodes, id);
    if (!node || node.type !== "scene" || id === ws().activeId) return;
    commit({ activeId: id, expanded: withAncestorsExpanded(id) });
    await switchScene(id, { load: true, title: node.title });
  });
}

function withAncestorsExpanded(id: string) {
  const expanded = new Set(ws().expanded);
  let cur = byId(ws().nodes, byId(ws().nodes, id)?.parentId);
  while (cur) {
    expanded.add(cur.id);
    cur = byId(ws().nodes, cur.parentId);
  }
  return expanded;
}

export function createScene(parentId: string | null, title?: string) {
  return enqueue(async () => {
    const { nodes, node } = createNode(ws().nodes, "scene", parentId, title);
    commit({ nodes, activeId: node.id, renamingId: title ? null : node.id });
    commit({ expanded: withAncestorsExpanded(node.id) });
    await switchScene(node.id, { load: true, title: node.title });
    return node;
  });
}

export function createFolder(parentId: string | null, title?: string) {
  const { nodes, node } = createNode(ws().nodes, "folder", parentId, title);
  const expanded = new Set(ws().expanded);
  if (parentId) expanded.add(parentId);
  expanded.add(node.id);
  commit({ nodes, expanded, renamingId: title ? null : node.id });
  return node;
}

export function renameNodeTitle(id: string, title: string) {
  commit({ nodes: renameNode(ws().nodes, id, title), renamingId: null });
  if (id === ws().activeId && title.trim()) getState().setAppState({ name: title.trim() });
}

export function moveTreeNode(id: string, parentId: string | null, beforeId: string | null = null) {
  const nodes = moveNode(ws().nodes, id, parentId, beforeId);
  if (nodes === ws().nodes) return false;
  const expanded = new Set(ws().expanded);
  if (parentId) expanded.add(parentId);
  commit({ nodes, expanded });
  return true;
}

export function toggleExpanded(id: string, open?: boolean) {
  const expanded = new Set(ws().expanded);
  if (open ?? !expanded.has(id)) expanded.add(id);
  else expanded.delete(id);
  commit({ expanded });
}

export function duplicateTreeNode(id: string) {
  return enqueue(async () => {
    const { nodes, idMap, rootId } = duplicateNode(ws().nodes, id);
    for (const [oldId, nid] of idMap) {
      if (byId(ws().nodes, oldId)?.type !== "scene") continue;
      const scene = await readSceneWithFiles(oldId);
      if (scene) await writeSceneWithFiles(nid, scene);
    }
    commit({ nodes, expanded: new Set([...ws().expanded, ...(byId(nodes, rootId)?.parentId ? [byId(nodes, rootId)!.parentId!] : [])]) });
    return rootId;
  });
}

export function deleteTreeNode(id: string) {
  return enqueue(async () => {
    const { nodes, removed } = deleteNode(ws().nodes, id);
    const sceneIds = ws().nodes.filter((n) => removed.has(n.id) && n.type === "scene").map((n) => n.id);
    let next = nodes;
    const activeRemoved = removed.has(ws().activeId ?? "");
    let target = activeRemoved ? firstScene(next) : undefined;
    if (activeRemoved && !target) {
      // never leave the workspace without a scene
      const created = createNode(next, "scene", null);
      next = created.nodes;
      target = created.node;
    }
    commit({ nodes: next, ...(target ? { activeId: target.id } : {}) });
    await repo.deleteScenes(sceneIds);
    if (target) await switchScene(target.id, { load: true, saveCurrent: false, title: target.title });
  });
}

/** Store whatever is on the canvas as a brand-new scene (share links, ended collab sessions). */
export function saveCanvasAsNewScene(title: string) {
  return enqueue(async () => {
    await initWorkspace();
    const { nodes, node } = createNode(ws().nodes, "scene", null, title);
    commit({ nodes, activeId: node.id });
    await switchScene(node.id, { load: false, saveCurrent: false, title: node.title });
    return node;
  });
}

// ---- export / import ---------------------------------------------------------------------------

interface WorkspaceFile {
  type: "excalimade-workspace";
  version: 1;
  exportedAt: string;
  nodes: TreeNode[];
  scenes: Record<string, RestoredScene>;
}

export async function exportWorkspace() {
  const { nodes } = ws();
  const scenes: Record<string, RestoredScene> = {};
  for (const n of nodes) {
    if (n.type !== "scene") continue;
    const scene = await readSceneWithFiles(n.id);
    if (scene) scenes[n.id] = scene;
  }
  const file: WorkspaceFile = { type: "excalimade-workspace", version: 1, exportedAt: new Date().toISOString(), nodes, scenes };
  const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `excalimade-workspace-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Import a workspace file into a new top-level folder (never overwrites existing scenes). */
export function importWorkspace(text: string) {
  return enqueue(async () => {
    let data: WorkspaceFile;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("The file is not valid JSON.");
    }
    if (data?.type !== "excalimade-workspace" || !Array.isArray(data.nodes)) throw new Error("This isn't an Excalimade workspace file.");
    const idMap = new Map<string, string>();
    for (const n of data.nodes) idMap.set(n.id, newId());
    const folder = createNode(ws().nodes, "folder", null, `Imported ${new Date().toLocaleDateString()}`);
    const now = Date.now();
    const imported: TreeNode[] = data.nodes.map((n) => ({
      id: idMap.get(n.id)!,
      parentId: n.parentId && idMap.has(n.parentId) ? idMap.get(n.parentId)! : folder.node.id,
      type: n.type === "folder" ? "folder" : "scene",
      title: String(n.title ?? "Untitled").slice(0, 200),
      order: Number(n.order) || 0,
      createdAt: Number(n.createdAt) || now,
      updatedAt: Number(n.updatedAt) || now,
    }));
    for (const n of data.nodes) {
      if (n.type !== "scene" || !data.scenes?.[n.id]) continue;
      const scene = parseScene({ type: "excalidraw", version: 2, ...data.scenes[n.id] });
      await writeSceneWithFiles(idMap.get(n.id)!, { ...scene, files: data.scenes[n.id].files ?? {} });
    }
    commit({ nodes: [...folder.nodes, ...imported], expanded: new Set([...ws().expanded, folder.node.id]) });
    showToast(`Imported ${imported.filter((n) => n.type === "scene").length} scenes`, "success");
  });
}

export const getActiveNode = () => byId(ws().nodes, ws().activeId ?? getActiveSceneId());
export { childrenOf };

import { registerActions } from "../core/actions";
registerActions([
  {
    id: "workspace.toggle",
    label: "Scenes sidebar",
    category: "view",
    keywords: ["scenes", "files", "folders", "tree", "workspace", "pages", "screens"],
    perform: () => setSidebarOpen(!useWorkspace.getState().sidebarOpen),
  },
  {
    id: "workspace.newScene",
    label: "New scene",
    category: "editor",
    keywords: ["scene", "page", "screen", "file", "create"],
    perform: () => void createScene(useWorkspace.getState().nodes.find((n) => n.id === useWorkspace.getState().activeId)?.parentId ?? null),
  },
]);
