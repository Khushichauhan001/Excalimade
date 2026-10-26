// Scene file format (.excalidraw JSON) — serialize to an excalidraw.com-compatible document and
// restore anything (ours, excalidraw.com's current or legacy files) into valid Excalimade elements.
import {
  getState,
  useStore,
  getNonDeletedElements,
  PERSISTED_APPSTATE_KEYS,
  LIGHT_BG,
} from "../core/store";
import type {
  AppState,
  ArrowType,
  Arrowhead,
  BinaryFiles,
  Binding,
  ExcalidrawElement,
  ImageElement,
  Point,
  Roundness,
  Scene,
} from "../core/types";
import { SHAPE_TYPES } from "../core/types";
import { FONTS } from "../core/text";
import { emit } from "../core/events";
import { zoomToFit } from "../core/viewport";
import { randomId, randomInteger } from "../core/utils";

export const SCENE_SOURCE = typeof location !== "undefined" ? location.origin : "https://excalimade.app";

type PersistedKey = (typeof PERSISTED_APPSTATE_KEYS)[number];
export type PersistedAppState = Pick<AppState, PersistedKey>;

// ---------------------------------------------------------------------------------------------
// serialize

export interface SerializeOptions {
  elements?: readonly ExcalidrawElement[];
  appState?: AppState;
  files?: BinaryFiles;
  /**
   * Convert fields to excalidraw.com's representation (roundness objects, elbowed, binding focus)
   * so the file opens there too. Our own extra fields (arrowType, …) are kept, so the round trip is lossless.
   * Default true.
   */
  compat?: boolean;
}

export const pickPersistedAppState = (as: AppState): Partial<AppState> => {
  const out: Record<string, unknown> = {};
  for (const k of PERSISTED_APPSTATE_KEYS) out[k] = as[k];
  return out as Partial<AppState>;
};

/** Only the files referenced by the given (non-deleted) image elements. */
export const getReferencedFiles = (elements: readonly ExcalidrawElement[], files: BinaryFiles): BinaryFiles => {
  const out: BinaryFiles = {};
  for (const el of elements) {
    if (el.type === "image" && !el.isDeleted) {
      const f = files[(el as ImageElement).fileId];
      if (f) out[f.id] = f;
    }
  }
  return out;
};

/** One element in excalidraw.com's representation (roundness objects, elbowed, binding focus). */
export const toCompatElement = (el: ExcalidrawElement): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...el };
  const isLin = el.type === "arrow" || el.type === "line";
  if (isLin) {
    const lin = el as Extract<ExcalidrawElement, { type: "arrow" | "line" }>;
    out.roundness = lin.arrowType === "round" || (el.type === "line" && el.roundness === "round") ? { type: 2 } : null;
    out.elbowed = lin.arrowType === "elbow";
    const b = (x: Binding | null) => (x ? { elementId: x.elementId, focus: 0, gap: x.gap, ...(x.fixedPoint ? { fixedPoint: x.fixedPoint } : {}) } : null);
    out.startBinding = b(lin.startBinding);
    out.endBinding = b(lin.endBinding);
  } else if (el.type === "text" || el.type === "freedraw" || el.type === "image" || el.type === "frame") {
    out.roundness = el.roundness === "round" && el.type === "image" ? { type: 3 } : null;
  } else {
    out.roundness = el.roundness === "round" ? { type: el.type === "rectangle" || el.type === "embeddable" ? 3 : 2 } : null;
  }
  if (el.type === "image") out.status = "saved";
  if (el.type === "text") out.baseline = Math.round((el as { fontSize: number }).fontSize * 0.9);
  return out;
};

/** The current (or given) scene as an Excalidraw-compatible document object. */
export function serializeSceneObject(opts: SerializeOptions = {}): Scene {
  const s = getState();
  const elements = getNonDeletedElements((opts.elements ?? s.elements) as ExcalidrawElement[]);
  const appState = opts.appState ?? s.appState;
  const files = getReferencedFiles(elements, opts.files ?? s.files);
  const compat = opts.compat !== false;
  return {
    type: "excalidraw",
    version: 2,
    source: SCENE_SOURCE,
    elements: (compat ? elements.map(toCompatElement) : elements) as ExcalidrawElement[],
    appState: pickPersistedAppState(appState),
    files,
  };
}

/** The current (or given) scene as `.excalidraw` JSON text. */
export const serializeScene = (opts: SerializeOptions = {}) => JSON.stringify(serializeSceneObject(opts));

// ---------------------------------------------------------------------------------------------
// restore

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  allowed.includes(v as T) ? (v as T) : d;

const FILL_STYLES = ["hachure", "cross-hatch", "solid", "zigzag", "dots"] as const;
const STROKE_STYLES = ["solid", "dashed", "dotted"] as const;
const ARROWHEADS = [
  "arrow", "bar", "dot", "circle", "circle_outline", "triangle", "triangle_outline",
  "diamond", "diamond_outline", "crowfoot_one", "crowfoot_many", "crowfoot_one_or_many",
] as const;
const KNOWN_FONT_IDS = new Set(FONTS.map((f) => f.id));

/** Excalidraw font ids we don't ship are mapped to the closest one we have. */
export const restoreFontFamily = (v: unknown): number => {
  const id = num(v, 5);
  if (KNOWN_FONT_IDS.has(id)) return id;
  if (id === 4) return 6; // Assistant → Nunito
  return 5;
};

const restoreArrowhead = (v: unknown): Arrowhead => {
  if (v === "triangle_outline" || (ARROWHEADS as readonly string[]).includes(v as string)) return v as Arrowhead;
  if (v === "circle_outlined") return "circle_outline";
  return null;
};

const restoreRoundness = (raw: Record<string, unknown>, type: string): Roundness => {
  const r = raw.roundness;
  if (r === "round" || r === "sharp") return r;
  if (r && typeof r === "object") return "round";
  if (r === null) return "sharp";
  // legacy files (pre-2022) used `strokeSharpness`
  if (raw.strokeSharpness === "round") return "round";
  if (raw.strokeSharpness === "sharp") return "sharp";
  return type === "text" || type === "frame" || type === "freedraw" ? "sharp" : "round";
};

const restorePoints = (v: unknown): Point[] => {
  const pts = Array.isArray(v)
    ? v.filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(
        (p) => [p[0], p[1]] as Point,
      )
    : [];
  return pts.length ? pts : [[0, 0]];
};

const restoreBinding = (v: unknown): Binding | null => {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  if (typeof b.elementId !== "string") return null;
  const fp = b.fixedPoint;
  return {
    elementId: b.elementId,
    fixedPoint: Array.isArray(fp) && fp.length === 2 && fp.every(Number.isFinite) ? [fp[0], fp[1]] : null,
    gap: num(b.gap, 4),
  };
};

const TYPE_ALIASES: Record<string, string> = { magicframe: "frame", iframe: "embeddable" };

/** Restore a single raw element (from any source). Returns null for unsupported/invalid elements. */
export function restoreElement(rawInput: unknown): ExcalidrawElement | null {
  if (!rawInput || typeof rawInput !== "object") return null;
  const raw = rawInput as Record<string, unknown>;
  const type = TYPE_ALIASES[raw.type as string] ?? (raw.type as string);
  const supported =
    (SHAPE_TYPES as string[]).includes(type) ||
    ["text", "arrow", "line", "freedraw", "image", "frame", "embeddable"].includes(type);
  if (!supported) return null;

  const customData = raw.customData && typeof raw.customData === "object" ? (raw.customData as Record<string, unknown>) : undefined;

  const base = {
    id: str(raw.id, "") || randomId(),
    type,
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    width: num(raw.width, 0),
    height: num(raw.height, 0),
    angle: num(raw.angle, 0),
    strokeColor: str(raw.strokeColor, "#1e1e1e"),
    backgroundColor: str(raw.backgroundColor, "transparent"),
    fillStyle: oneOf(raw.fillStyle, FILL_STYLES, "solid"),
    strokeWidth: num(raw.strokeWidth, 2),
    strokeStyle: oneOf(raw.strokeStyle, STROKE_STYLES, "solid"),
    roughness: num(raw.roughness, 1),
    roundness: restoreRoundness(raw, type),
    opacity: num(raw.opacity, 100),
    seed: num(raw.seed, randomInteger()),
    version: num(raw.version, 1),
    versionNonce: num(raw.versionNonce, randomInteger()),
    updated: num(raw.updated, Date.now()),
    isDeleted: bool(raw.isDeleted, false),
    locked: bool(raw.locked, false),
    groupIds: Array.isArray(raw.groupIds) ? raw.groupIds.filter((g): g is string => typeof g === "string") : [],
    frameId: typeof raw.frameId === "string" ? raw.frameId : null,
    link: typeof raw.link === "string" && raw.link ? raw.link : null,
    boundElements: Array.isArray(raw.boundElements)
      ? raw.boundElements
          .filter((b): b is { id: string; type: "arrow" | "text" } => !!b && typeof b.id === "string" && (b.type === "arrow" || b.type === "text"))
          .map((b) => ({ id: b.id, type: b.type }))
      : [],
    ...(customData && Object.keys(customData).length ? { customData } : {}),
  };

  switch (type) {
    case "text": {
      const text = str(raw.text, "");
      const fontSize = num(raw.fontSize, 20);
      return {
        ...base,
        type: "text",
        text,
        originalText: str(raw.originalText, text),
        fontSize,
        fontFamily: restoreFontFamily(raw.fontFamily),
        textAlign: oneOf(raw.textAlign, ["left", "center", "right"] as const, "left"),
        verticalAlign: oneOf(raw.verticalAlign, ["top", "middle", "bottom"] as const, "top"),
        lineHeight: num(raw.lineHeight, 1.25),
        containerId: typeof raw.containerId === "string" ? raw.containerId : null,
        autoResize: bool(raw.autoResize, true),
      };
    }
    case "arrow":
    case "line": {
      let points = restorePoints(raw.points);
      // normalise so the first point is [0,0]
      const [ox, oy] = points[0];
      if (ox || oy) {
        points = points.map(([px, py]) => [px - ox, py - oy] as Point);
        base.x += ox;
        base.y += oy;
      }
      if (points.length < 2) points = [[0, 0], [num(raw.width, 0), num(raw.height, 0)]];
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      let arrowType: ArrowType;
      if (raw.arrowType === "sharp" || raw.arrowType === "round" || raw.arrowType === "elbow") arrowType = raw.arrowType;
      else if (raw.elbowed === true) arrowType = "elbow";
      else if (raw.roundness && typeof raw.roundness === "object") arrowType = "round";
      else if (raw.roundness === undefined && raw.strokeSharpness === "round") arrowType = "round";
      else arrowType = "sharp";
      return {
        ...base,
        type,
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        roundness: type === "line" ? (arrowType === "round" ? "round" : base.roundness) : arrowType === "round" ? "round" : "sharp",
        points,
        startArrowhead: restoreArrowhead(raw.startArrowhead),
        endArrowhead: raw.endArrowhead === undefined && type === "arrow" ? "arrow" : restoreArrowhead(raw.endArrowhead),
        arrowType: type === "line" ? (arrowType === "elbow" ? "sharp" : arrowType) : arrowType,
        startBinding: restoreBinding(raw.startBinding),
        endBinding: restoreBinding(raw.endBinding),
        polygon: bool(raw.polygon, false),
      };
    }
    case "freedraw": {
      const points = restorePoints(raw.points);
      return {
        ...base,
        type: "freedraw",
        points,
        pressures: Array.isArray(raw.pressures) ? raw.pressures.filter(Number.isFinite) : [],
        simulatePressure: bool(raw.simulatePressure, true),
      };
    }
    case "image": {
      if (typeof raw.fileId !== "string") return null;
      const sc = raw.scale;
      const crop = raw.crop as Record<string, unknown> | null | undefined;
      return {
        ...base,
        type: "image",
        fileId: raw.fileId,
        scale: Array.isArray(sc) && sc.length === 2 ? [sc[0] < 0 ? -1 : 1, sc[1] < 0 ? -1 : 1] : [1, 1],
        crop:
          crop && typeof crop === "object" && ["x", "y", "width", "height", "naturalWidth", "naturalHeight"].every((k) => Number.isFinite(crop[k]))
            ? {
                x: crop.x as number,
                y: crop.y as number,
                width: crop.width as number,
                height: crop.height as number,
                naturalWidth: crop.naturalWidth as number,
                naturalHeight: crop.naturalHeight as number,
              }
            : null,
      };
    }
    case "frame":
      return { ...base, type: "frame", name: typeof raw.name === "string" ? raw.name : null };
    case "embeddable":
      return { ...base, type: "embeddable" };
    default:
      return { ...base, type } as ExcalidrawElement;
  }
}

/**
 * Restore a list of raw elements: fills defaults, maps excalidraw.com fields to ours, drops unsupported
 * types and repairs dangling references (bound elements, containers, bindings, frames).
 */
export function restoreElements(raw: unknown, opts: { keepDeleted?: boolean } = {}): ExcalidrawElement[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  let els: ExcalidrawElement[] = [];
  for (const r of raw) {
    const el = restoreElement(r);
    if (!el || seen.has(el.id)) continue;
    if (el.isDeleted && !opts.keepDeleted) continue;
    seen.add(el.id);
    els.push(el);
  }
  const byId = new Map(els.map((e) => [e.id, e]));
  const live = (id: string | null | undefined) => !!id && !!byId.get(id) && !byId.get(id)!.isDeleted;
  els = els.map((el) => {
    let next = el;
    const patch = (p: Partial<ExcalidrawElement>) => (next = { ...next, ...p } as ExcalidrawElement);
    const bound = el.boundElements.filter((b) => live(b.id));
    if (bound.length !== el.boundElements.length) patch({ boundElements: bound });
    if (el.frameId && byId.get(el.frameId)?.type !== "frame") patch({ frameId: null });
    if (el.type === "text" && el.containerId && !live(el.containerId)) {
      patch({ containerId: null } as Partial<ExcalidrawElement>);
    }
    if (el.type === "arrow" || el.type === "line") {
      if (el.startBinding && !live(el.startBinding.elementId)) patch({ startBinding: null } as Partial<ExcalidrawElement>);
      if (el.endBinding && !live(el.endBinding.elementId)) patch({ endBinding: null } as Partial<ExcalidrawElement>);
    }
    return next;
  });
  // make sure containers list their labels (some older files only set containerId)
  const fixed = new Map(els.map((e) => [e.id, e]));
  for (const el of els) {
    if (el.type === "text" && el.containerId) {
      const c = fixed.get(el.containerId)!;
      if (!c.boundElements.some((b) => b.id === el.id))
        fixed.set(c.id, { ...c, boundElements: [...c.boundElements, { id: el.id, type: "text" }] });
    }
  }
  return els.map((e) => fixed.get(e.id)!);
}

/** Restore persisted appState fields from any source (validates every value). */
export function restoreAppState(raw: unknown): Partial<PersistedAppState> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<PersistedAppState> = {};
  const zoom = typeof r.zoom === "object" && r.zoom ? (r.zoom as { value?: unknown }).value : r.zoom;
  if (Number.isFinite(r.scrollX)) out.scrollX = r.scrollX as number;
  if (Number.isFinite(r.scrollY)) out.scrollY = r.scrollY as number;
  if (Number.isFinite(zoom) && (zoom as number) > 0) out.zoom = Math.min(30, Math.max(0.1, zoom as number));
  if (r.theme === "light" || r.theme === "dark") out.theme = r.theme;
  if (typeof r.viewBackgroundColor === "string") out.viewBackgroundColor = r.viewBackgroundColor;
  if (typeof r.gridModeEnabled === "boolean") out.gridModeEnabled = r.gridModeEnabled;
  else if (r.gridSize === null) out.gridModeEnabled = false; // legacy: gridSize null = off
  if (Number.isFinite(r.gridSize) && (r.gridSize as number) > 0) out.gridSize = r.gridSize as number;
  if (typeof r.objectsSnapModeEnabled === "boolean") out.objectsSnapModeEnabled = r.objectsSnapModeEnabled;
  if (typeof r.name === "string" && r.name) out.name = r.name;
  // slide settings belong to the scene: always set them so another scene's order never leaks in
  const sl = r.slides as { order?: unknown; hidden?: unknown } | undefined;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 1000) : []);
  out.slides = { order: ids(sl?.order), hidden: ids(sl?.hidden) };
  if (typeof r.username === "string") out.username = r.username;
  if (typeof r.currentItemStrokeColor === "string") out.currentItemStrokeColor = r.currentItemStrokeColor;
  if (typeof r.currentItemBackgroundColor === "string") out.currentItemBackgroundColor = r.currentItemBackgroundColor;
  if ((FILL_STYLES as readonly unknown[]).includes(r.currentItemFillStyle)) out.currentItemFillStyle = r.currentItemFillStyle as AppState["currentItemFillStyle"];
  if (Number.isFinite(r.currentItemStrokeWidth)) out.currentItemStrokeWidth = r.currentItemStrokeWidth as number;
  if ((STROKE_STYLES as readonly unknown[]).includes(r.currentItemStrokeStyle)) out.currentItemStrokeStyle = r.currentItemStrokeStyle as AppState["currentItemStrokeStyle"];
  if (Number.isFinite(r.currentItemRoughness)) out.currentItemRoughness = r.currentItemRoughness as number;
  if (r.currentItemRoundness === "round" || r.currentItemRoundness === "sharp") out.currentItemRoundness = r.currentItemRoundness;
  if (Number.isFinite(r.currentItemOpacity)) out.currentItemOpacity = r.currentItemOpacity as number;
  if (r.currentItemFontFamily !== undefined) out.currentItemFontFamily = restoreFontFamily(r.currentItemFontFamily);
  if (Number.isFinite(r.currentItemFontSize)) out.currentItemFontSize = r.currentItemFontSize as number;
  if (r.currentItemTextAlign === "left" || r.currentItemTextAlign === "center" || r.currentItemTextAlign === "right")
    out.currentItemTextAlign = r.currentItemTextAlign;
  if ("currentItemStartArrowhead" in r) out.currentItemStartArrowhead = restoreArrowhead(r.currentItemStartArrowhead);
  if ("currentItemEndArrowhead" in r) out.currentItemEndArrowhead = restoreArrowhead(r.currentItemEndArrowhead);
  if (r.currentItemArrowType === "sharp" || r.currentItemArrowType === "round" || r.currentItemArrowType === "elbow")
    out.currentItemArrowType = r.currentItemArrowType;
  return out;
}

export function restoreFiles(raw: unknown): BinaryFiles {
  const out: BinaryFiles = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const f = v as Record<string, unknown>;
    if (typeof f.dataURL !== "string" || !f.dataURL.startsWith("data:")) continue;
    const id = typeof f.id === "string" ? f.id : key;
    out[id] = {
      id,
      mimeType: typeof f.mimeType === "string" ? f.mimeType : f.dataURL.slice(5, f.dataURL.indexOf(";")) || "image/png",
      dataURL: f.dataURL,
      created: num(f.created, Date.now()),
    };
  }
  return out;
}

export interface RestoredScene {
  elements: ExcalidrawElement[];
  appState: Partial<PersistedAppState>;
  files: BinaryFiles;
}

export class InvalidSceneError extends Error {}

/** Parse + validate scene JSON (string or object) without touching the store. */
export function parseScene(input: string | unknown): RestoredScene {
  let data: unknown = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch {
      throw new InvalidSceneError("The file is not valid JSON.");
    }
  }
  if (!data || typeof data !== "object") throw new InvalidSceneError("Invalid scene file.");
  const d = data as Record<string, unknown>;
  if (d.type === "excalidrawlib") throw new InvalidSceneError("This is a library file — import it into the library instead.");
  // excalidraw.com accepts files without `type` as long as they have an elements array
  if (d.type !== undefined && d.type !== "excalidraw" && d.type !== "excalidraw/clipboard")
    throw new InvalidSceneError("Not an Excalidraw scene file.");
  if (!Array.isArray(d.elements)) throw new InvalidSceneError("The scene has no elements list.");
  const elements = restoreElements(d.elements);
  return { elements, appState: restoreAppState(d.appState), files: restoreFiles(d.files) };
}

export interface ApplySceneOptions {
  /** Apply the scene's theme/username too (local autosave); files from disk keep the user's own. */
  applyPreferences?: boolean;
  /** Zoom to fit the content after loading (default true). */
  fit?: boolean;
}

/** Replace the current scene with a restored one, clear history and notify other modules. */
export function applyScene(
  scene: RestoredScene,
  source: "file" | "link" | "cloud" | "local" | "collab",
  opts: ApplySceneOptions = {},
) {
  const s = getState();
  const appState = { ...scene.appState };
  if (!opts.applyPreferences) {
    delete appState.theme;
    delete appState.username;
  }
  if (!appState.viewBackgroundColor) appState.viewBackgroundColor = LIGHT_BG;
  useStore.setState((st) => ({
    elements: scene.elements,
    files: scene.files,
    appState: {
      ...st.appState,
      ...appState,
      selectedElementIds: {},
      editingGroupId: null,
      editingTextId: null,
      editingLinearId: null,
      croppingImageId: null,
      editingFrameNameId: null,
      contextMenu: null,
      presentationMode: null,
    },
    sceneNonce: st.sceneNonce + 1,
  }));
  s.clearHistory();
  if (opts.fit !== false) zoomToFit(scene.elements.filter((e) => !e.isDeleted), { padding: 60, maxZoom: 1 });
  emit("sceneLoaded", { source });
}

/** Parse, validate, restore and load scene JSON into the editor. Throws InvalidSceneError. */
export function loadScene(
  json: string | unknown,
  source: "file" | "link" | "cloud" | "local" | "collab" = "file",
  opts: ApplySceneOptions = {},
): RestoredScene {
  const scene = parseScene(json);
  applyScene(scene, source, opts);
  return scene;
}
