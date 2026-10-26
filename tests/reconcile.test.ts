import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileElements, remoteWins } from "../src/collab/reconcile.ts";
import type { ExcalidrawElement } from "../src/core/types.ts";

const el = (id: string, version: number, versionNonce = 1, extra: Partial<ExcalidrawElement> = {}): ExcalidrawElement =>
  ({
    id, type: "rectangle", x: 0, y: 0, width: 10, height: 10, angle: 0, strokeColor: "#000", backgroundColor: "transparent",
    fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, roundness: "round", opacity: 100, seed: 1,
    version, versionNonce, updated: 0, isDeleted: false, locked: false, groupIds: [], frameId: null, link: null, boundElements: [],
    ...extra,
  }) as ExcalidrawElement;
const opts = { isLocallyEditing: () => false };

test("higher version wins; ties go to the lower versionNonce", () => {
  assert.equal(remoteWins(el("a", 1), el("a", 2)), true);
  assert.equal(remoteWins(el("a", 3), el("a", 2)), false);
  assert.equal(remoteWins(el("a", 2, 50), el("a", 2, 10)), true);
  assert.equal(remoteWins(el("a", 2, 10), el("a", 2, 50)), false);
});

test("newer remote elements replace local ones, older are ignored", () => {
  const local = [el("a", 1), el("b", 5)];
  const { elements, accepted } = reconcileElements(local, [el("a", 2, 1, { x: 99 }), el("b", 4, 1, { x: 7 })], opts);
  assert.equal(elements.find((e) => e.id === "a")!.x, 99);
  assert.equal(elements.find((e) => e.id === "b")!.x, 0);
  assert.deepEqual(accepted.map((e) => e.id), ["a"]);
});

test("new remote elements are added after their predecessor", () => {
  const { elements } = reconcileElements([el("a", 1), el("c", 1)], [el("b", 1)], { ...opts, after: ["a"] });
  assert.deepEqual(elements.map((e) => e.id), ["a", "b", "c"]);
});

test("deletions propagate as tombstones", () => {
  const { elements } = reconcileElements([el("a", 1)], [el("a", 2, 1, { isDeleted: true })], opts);
  assert.equal(elements[0].isDeleted, true);
});

test("elements being edited locally are never overwritten", () => {
  const { elements } = reconcileElements([el("a", 1)], [el("a", 9, 1, { x: 50 })], { isLocallyEditing: (id) => id === "a" });
  assert.equal(elements[0].x, 0);
});

test("malformed remote data is ignored", () => {
  const { elements } = reconcileElements([el("a", 1)], [null, { id: 5 }, "junk", { id: "x", type: "rectangle" }], opts);
  assert.deepEqual(elements.map((e) => e.id), ["a"]);
});

test("both peers converge to the same state", () => {
  const base = [el("a", 1), el("b", 1)];
  const peer1 = [el("a", 2, 30, { x: 1 }), el("b", 1)];
  const peer2 = [el("a", 2, 20, { x: 2 }), el("b", 2, 5, { y: 3 })];
  const at1 = reconcileElements(peer1, peer2, opts).elements;
  const at2 = reconcileElements(peer2, peer1, opts).elements;
  assert.deepEqual(at1.map((e) => [e.id, e.x, e.y]), at2.map((e) => [e.id, e.x, e.y]));
  void base;
});
