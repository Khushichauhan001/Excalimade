import { test } from "node:test";
import assert from "node:assert/strict";
import { createNode, moveNode, deleteNode, duplicateNode, renameNode, pathTo, childrenOf, visibleRows, firstScene, canMove, type TreeNode } from "../src/workspace/tree.ts";

const build = () => {
  let nodes: TreeNode[] = [];
  const add = (type: "folder" | "scene", parent: string | null, title: string) => {
    const r = createNode(nodes, type, parent, title);
    nodes = r.nodes;
    return r.node;
  };
  const project = add("folder", null, "Project");
  const backend = add("folder", project.id, "Backend");
  const auth = add("scene", backend.id, "Auth flow");
  const child = add("scene", auth.id, "Auth details");
  const home = add("scene", null, "Home");
  return { nodes, project, backend, auth, child, home };
};

test("create nests to any depth and keeps sibling order", () => {
  const { nodes, project, backend, auth, child } = build();
  assert.deepEqual(pathTo(nodes, child.id).map((n) => n.title), ["Project", "Backend", "Auth flow", "Auth details"]);
  assert.deepEqual(childrenOf(nodes, null).map((n) => n.title), ["Project", "Home"]);
  assert.equal(childrenOf(nodes, project.id)[0].id, backend.id);
  assert.equal(childrenOf(nodes, auth.id)[0].id, child.id);
});

test("rename trims and ignores empty titles", () => {
  const { nodes, home } = build();
  assert.equal(renameNode(nodes, home.id, "  Landing  ").find((n) => n.id === home.id)!.title, "Landing");
  assert.equal(renameNode(nodes, home.id, "   ").find((n) => n.id === home.id)!.title, "Home");
});

test("move reparents and reorders; refuses cycles", () => {
  const { nodes, project, backend, home } = build();
  const moved = moveNode(nodes, home.id, project.id, backend.id);
  assert.deepEqual(childrenOf(moved, project.id).map((n) => n.title), ["Home", "Backend"]);
  assert.equal(canMove(nodes, project.id, backend.id), false);
  assert.equal(moveNode(nodes, project.id, backend.id), nodes); // into own descendant → unchanged
  const toRoot = moveNode(nodes, backend.id, null);
  assert.deepEqual(childrenOf(toRoot, null).map((n) => n.title), ["Project", "Home", "Backend"]);
});

test("delete removes the whole subtree", () => {
  const { nodes, project, home } = build();
  const { nodes: left, removed } = deleteNode(nodes, project.id);
  assert.equal(removed.size, 4);
  assert.deepEqual(left.map((n) => n.id), [home.id]);
  assert.equal(firstScene(left)!.id, home.id);
});

test("duplicate deep-copies with new ids, placed after the original", () => {
  const { nodes, backend, project } = build();
  const { nodes: next, idMap, rootId } = duplicateNode(nodes, backend.id);
  assert.equal(idMap.size, 3);
  assert.equal(next.length, nodes.length + 3);
  assert.deepEqual(childrenOf(next, project.id).map((n) => n.title), ["Backend", "Backend (copy)"]);
  assert.deepEqual(pathTo(next, idMap.get([...idMap.keys()].at(-1)!)!).map((n) => n.title), ["Project", "Backend (copy)", "Auth flow", "Auth details"]);
  assert.notEqual(rootId, backend.id);
});

test("visible rows respect collapsed folders and search", () => {
  const { nodes, project, backend } = build();
  assert.deepEqual(visibleRows(nodes, new Set()).map((r) => r.node.title), ["Project", "Home"]);
  const open = visibleRows(nodes, new Set([project.id, backend.id]));
  assert.deepEqual(open.map((r) => [r.node.title, r.depth]), [["Project", 0], ["Backend", 1], ["Auth flow", 2], ["Home", 0]]);
  assert.deepEqual(visibleRows(nodes, new Set(), "details").map((r) => r.node.title), ["Project", "Backend", "Auth flow", "Auth details"]);
});

test("handles 500 scenes", () => {
  let nodes: TreeNode[] = [];
  for (let i = 0; i < 500; i++) nodes = createNode(nodes, "scene", null, `S${i}`).nodes;
  assert.equal(childrenOf(nodes, null).length, 500);
  assert.equal(childrenOf(nodes, null)[499].title, "S499");
});
