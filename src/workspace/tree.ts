// Pure operations on the workspace tree (folders and scenes, nestable to any depth).
// No I/O here, so it is easy to test; persistence lives in repo.ts.

export type NodeType = "folder" | "scene";

export interface TreeNode {
  id: string;
  parentId: string | null;
  type: NodeType;
  title: string;
  /** Sort key among siblings (fractional values allow inserting between two nodes). */
  order: number;
  createdAt: number;
  updatedAt: number;
}

export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export const childrenOf = (nodes: readonly TreeNode[], parentId: string | null) =>
  nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);

export const byId = (nodes: readonly TreeNode[], id: string | null | undefined) => (id ? nodes.find((n) => n.id === id) : undefined);

/** Ids of `id` and all its descendants. */
export function subtreeIds(nodes: readonly TreeNode[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) if (n.parentId && out.has(n.parentId) && !out.has(n.id)) (out.add(n.id), (grew = true));
  }
  return out;
}

/** Root → node chain (for breadcrumbs). */
export function pathTo(nodes: readonly TreeNode[], id: string): TreeNode[] {
  const out: TreeNode[] = [];
  const seen = new Set<string>();
  let cur = byId(nodes, id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = byId(nodes, cur.parentId);
  }
  return out;
}

const nextOrder = (nodes: readonly TreeNode[], parentId: string | null) => {
  const sib = childrenOf(nodes, parentId);
  return sib.length ? sib[sib.length - 1].order + 1 : 0;
};

export function createNode(
  nodes: readonly TreeNode[],
  type: NodeType,
  parentId: string | null,
  title?: string,
  now = Date.now(),
): { nodes: TreeNode[]; node: TreeNode } {
  if (parentId && !byId(nodes, parentId)) parentId = null;
  const node: TreeNode = {
    id: newId(),
    parentId,
    type,
    title: title?.trim() || (type === "folder" ? "New folder" : "Untitled scene"),
    order: nextOrder(nodes, parentId),
    createdAt: now,
    updatedAt: now,
  };
  return { nodes: [...nodes, node], node };
}

export function renameNode(nodes: readonly TreeNode[], id: string, title: string, now = Date.now()): TreeNode[] {
  const t = title.trim();
  if (!t) return nodes as TreeNode[];
  return nodes.map((n) => (n.id === id ? { ...n, title: t, updatedAt: now } : n));
}

/** Can `id` be moved under `newParentId`? (not into itself or its own descendants) */
export const canMove = (nodes: readonly TreeNode[], id: string, newParentId: string | null) =>
  newParentId === null || !subtreeIds(nodes, id).has(newParentId);

/**
 * Move a node under `newParentId`, placed before `beforeId` (a sibling) or at the end.
 * Returns the unchanged array if the move would create a cycle.
 */
export function moveNode(nodes: readonly TreeNode[], id: string, newParentId: string | null, beforeId: string | null = null, now = Date.now()): TreeNode[] {
  const node = byId(nodes, id);
  if (!node || !canMove(nodes, id, newParentId) || beforeId === id) return nodes as TreeNode[];
  const siblings = childrenOf(nodes, newParentId).filter((n) => n.id !== id);
  const idx = beforeId ? siblings.findIndex((n) => n.id === beforeId) : -1;
  let order: number;
  if (idx === -1) order = siblings.length ? siblings[siblings.length - 1].order + 1 : 0;
  else if (idx === 0) order = siblings[0].order - 1;
  else order = (siblings[idx - 1].order + siblings[idx].order) / 2;
  return nodes.map((n) => (n.id === id ? { ...n, parentId: newParentId, order, updatedAt: now } : n));
}

/** Remove a node and everything under it. Returns the new nodes and the removed ids. */
export function deleteNode(nodes: readonly TreeNode[], id: string): { nodes: TreeNode[]; removed: Set<string> } {
  const removed = subtreeIds(nodes, id);
  return { nodes: nodes.filter((n) => !removed.has(n.id)), removed };
}

/**
 * Deep-copy a node and its subtree next to the original. Returns the new nodes plus
 * a map old id → new id (the caller copies scene contents for scene nodes).
 */
export function duplicateNode(nodes: readonly TreeNode[], id: string, now = Date.now()): { nodes: TreeNode[]; idMap: Map<string, string>; rootId: string } {
  const root = byId(nodes, id);
  if (!root) return { nodes: nodes as TreeNode[], idMap: new Map(), rootId: id };
  const ids = subtreeIds(nodes, id);
  const idMap = new Map<string, string>();
  for (const i of ids) idMap.set(i, newId());
  // place the copy right after the original
  const siblings = childrenOf(nodes, root.parentId);
  const pos = siblings.findIndex((n) => n.id === id);
  const next = siblings[pos + 1];
  const order = next ? (root.order + next.order) / 2 : root.order + 1;
  const copies = nodes
    .filter((n) => ids.has(n.id))
    .map((n) => ({
      ...n,
      id: idMap.get(n.id)!,
      parentId: n.id === id ? n.parentId : idMap.get(n.parentId!)!,
      title: n.id === id ? `${n.title} (copy)` : n.title,
      order: n.id === id ? order : n.order,
      createdAt: now,
      updatedAt: now,
    }));
  return { nodes: [...nodes, ...copies], idMap, rootId: idMap.get(id)! };
}

/** Flattened depth-first list of visible rows (respecting collapsed folders and a title filter). */
export function visibleRows(nodes: readonly TreeNode[], expanded: ReadonlySet<string>, filter = ""): { node: TreeNode; depth: number; hasChildren: boolean }[] {
  const q = filter.trim().toLowerCase();
  const out: { node: TreeNode; depth: number; hasChildren: boolean }[] = [];
  if (q) {
    // when filtering: show matches with their ancestors, everything expanded
    const keep = new Set<string>();
    for (const n of nodes) if (n.title.toLowerCase().includes(q)) for (const p of pathTo(nodes, n.id)) keep.add(p.id);
    const walk = (parentId: string | null, depth: number) => {
      for (const n of childrenOf(nodes, parentId)) {
        if (!keep.has(n.id)) continue;
        out.push({ node: n, depth, hasChildren: nodes.some((c) => c.parentId === n.id) });
        walk(n.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }
  const walk = (parentId: string | null, depth: number) => {
    for (const n of childrenOf(nodes, parentId)) {
      const hasChildren = nodes.some((c) => c.parentId === n.id);
      out.push({ node: n, depth, hasChildren });
      if (hasChildren && expanded.has(n.id)) walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** First scene in tree order (used when the active scene is deleted). */
export function firstScene(nodes: readonly TreeNode[]): TreeNode | undefined {
  const walk = (parentId: string | null): TreeNode | undefined => {
    for (const n of childrenOf(nodes, parentId)) {
      if (n.type === "scene") return n;
      const inner = walk(n.id);
      if (inner) return inner;
    }
    return undefined;
  };
  return walk(null);
}
