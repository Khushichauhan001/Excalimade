// Workspace persistence. Everything goes through the WorkspaceRepository interface so a cloud
// implementation can be added later without touching the UI or autosave.
import { idbDelete, idbEntries, idbGet, idbSet } from "../io/idb";
import { createNode, type TreeNode } from "./tree";

export interface WorkspaceMeta {
  version: 1;
  nodes: TreeNode[];
  activeId: string;
  expanded: string[];
}

/** Stored scene content (same record format autosave has always used). */
export interface SceneRecord {
  data: Uint8Array; // gzip(JSON scene without files); images live in the shared "files" store
  updated: number;
  tab: string;
}

export interface WorkspaceRepository {
  loadMeta(): Promise<WorkspaceMeta | undefined>;
  saveMeta(meta: WorkspaceMeta): Promise<void>;
  readScene(id: string): Promise<SceneRecord | undefined>;
  writeScene(id: string, rec: SceneRecord): Promise<void>;
  deleteScenes(ids: Iterable<string>): Promise<void>;
  /** All stored scene records (used for image garbage collection and workspace export). */
  allScenes(): Promise<[string, SceneRecord][]>;
}

const META_KEY = "workspace:meta";
const LEGACY_KEY = "current"; // single-scene autosave from before workspaces
const sceneKey = (id: string) => `scene:${id}`;

export const idbRepository: WorkspaceRepository = {
  loadMeta: () => idbGet<WorkspaceMeta>("scene", META_KEY),
  saveMeta: (meta) => idbSet("scene", META_KEY, meta),
  readScene: (id) => idbGet<SceneRecord>("scene", sceneKey(id)),
  writeScene: (id, rec) => idbSet("scene", sceneKey(id), rec),
  async deleteScenes(ids) {
    for (const id of ids) await idbDelete("scene", sceneKey(id));
  },
  async allScenes() {
    const entries = await idbEntries<SceneRecord>("scene");
    return entries.filter(([k]) => k.startsWith("scene:")).map(([k, v]) => [k.slice(6), v] as [string, SceneRecord]);
  },
};

export let repo: WorkspaceRepository = idbRepository;
export const setRepository = (r: WorkspaceRepository) => void (repo = r);

/**
 * Load the workspace, creating it on first run. Existing single-scene data is migrated
 * into the first scene so nothing is lost.
 */
export async function loadOrCreateMeta(): Promise<WorkspaceMeta> {
  const meta = await repo.loadMeta();
  if (meta && meta.nodes.some((n) => n.id === meta.activeId && n.type === "scene")) return meta;
  if (meta && meta.nodes.some((n) => n.type === "scene")) {
    const first = meta.nodes.find((n) => n.type === "scene")!;
    return { ...meta, activeId: first.id };
  }
  const { nodes, node } = createNode(meta?.nodes ?? [], "scene", null, "My first scene");
  const legacy = await idbGet<SceneRecord>("scene", LEGACY_KEY).catch(() => undefined);
  if (legacy) {
    await repo.writeScene(node.id, legacy);
    await idbDelete("scene", LEGACY_KEY).catch(() => undefined);
  }
  const created: WorkspaceMeta = { version: 1, nodes, activeId: node.id, expanded: [] };
  await repo.saveMeta(created);
  return created;
}
