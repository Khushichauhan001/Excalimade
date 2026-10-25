// Merging remote element updates into the local scene.
import type { ExcalidrawElement } from "../core/types";

export interface ReconcileOptions {
  /** For each remote element, the id of the element directly below it in the sender's scene. */
  after?: (string | null)[];
  /** Full z-order (ids) of the sender's scene; applied to all elements it mentions. */
  order?: string[];
  /** Elements the local user is editing right now must not be overwritten. */
  isLocallyEditing: (id: string) => boolean;
}

/** Minimal structural validation so a malformed collaborator message can't crash the renderer. */
export function isValidElement(el: unknown): el is ExcalidrawElement {
  if (!el || typeof el !== "object") return false;
  const e = el as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    e.id.length > 0 &&
    e.id.length <= 128 &&
    typeof e.type === "string" &&
    typeof e.version === "number" &&
    Number.isFinite(e.version) &&
    typeof e.versionNonce === "number" &&
    typeof e.x === "number" &&
    Number.isFinite(e.x) &&
    typeof e.y === "number" &&
    Number.isFinite(e.y) &&
    typeof e.width === "number" &&
    typeof e.height === "number" &&
    typeof e.isDeleted === "boolean" &&
    (!("points" in e) || Array.isArray(e.points))
  );
}

/** Remote wins when it is newer; equal versions are broken by the lower versionNonce (deterministic everywhere). */
export const remoteWins = (local: ExcalidrawElement, remote: ExcalidrawElement) =>
  remote.version > local.version || (remote.version === local.version && remote.versionNonce < local.versionNonce);

export function reconcileElements(
  local: readonly ExcalidrawElement[],
  remote: readonly unknown[],
  opts: ReconcileOptions,
): { elements: ExcalidrawElement[]; accepted: ExcalidrawElement[]; changed: boolean } {
  const localById = new Map(local.map((e) => [e.id, e]));
  const replacements = new Map<string, ExcalidrawElement>();
  const accepted: ExcalidrawElement[] = [];
  const fresh: { el: ExcalidrawElement; after: string | null }[] = [];
  const seen = new Set<string>();

  remote.forEach((r, i) => {
    if (!isValidElement(r) || seen.has(r.id)) return;
    seen.add(r.id);
    const l = localById.get(r.id);
    if (!l) {
      const prev = remote[i - 1] as ExcalidrawElement | undefined;
      fresh.push({ el: r, after: opts.after ? (opts.after[i] ?? null) : (prev?.id ?? null) });
      accepted.push(r);
      return;
    }
    if (opts.isLocallyEditing(r.id)) return;
    if (remoteWins(l, r)) {
      replacements.set(r.id, r);
      accepted.push(r);
    }
  });

  let changed = accepted.length > 0;
  let merged = replacements.size ? local.map((e) => replacements.get(e.id) ?? e) : [...local];

  if (fresh.length) {
    // insert each new element right after its predecessor in the sender's scene
    const known = new Set<string>(merged.map((e) => e.id));
    for (const f of fresh) known.add(f.el.id);
    const START = "\u0000start";
    const END = "\u0000end";
    const children = new Map<string, ExcalidrawElement[]>();
    for (const f of fresh) {
      const key = f.after === null ? START : known.has(f.after) && f.after !== f.el.id ? f.after : END;
      const list = children.get(key);
      if (list) list.push(f.el);
      else children.set(key, [f.el]);
    }
    const out: ExcalidrawElement[] = [];
    const emitted = new Set<string>();
    const emitAll = (list: ExcalidrawElement[]) => {
      const stack = [...list].reverse();
      while (stack.length) {
        const el = stack.pop()!;
        if (emitted.has(el.id)) continue;
        emitted.add(el.id);
        out.push(el);
        const ch = children.get(el.id);
        if (ch) for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
      }
    };
    emitAll(children.get(START) ?? []);
    emitAll(merged);
    emitAll(children.get(END) ?? []);
    // anything left (cyclic "after" chains from a malicious/buggy peer) goes on top
    for (const f of fresh) if (!emitted.has(f.el.id)) out.push(f.el);
    merged = out;
  }

  if (opts.order && opts.order.length) {
    const pos = new Map<string, number>();
    opts.order.forEach((id, i) => typeof id === "string" && !pos.has(id) && pos.set(id, i));
    const ordered = merged.filter((e) => pos.has(e.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
    let k = 0;
    const reordered = merged.map((e) => (pos.has(e.id) ? ordered[k++] : e));
    if (reordered.some((e, i) => e !== merged[i])) {
      merged = reordered;
      changed = true;
    }
  }

  return { elements: merged, accepted, changed };
}
