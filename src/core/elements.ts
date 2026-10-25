// Element factories and scene-editing helpers shared by every module.
import type {
  ExcalidrawElement,
  FrameElement,
  FreeDrawElement,
  ImageElement,
  LinearElement,
  Point,
  ShapeElement,
  ShapeType,
  TextElement,
  EmbeddableElement,
  AppState,
} from "./types";
import { getState } from "./store";
import { randomId, randomInteger } from "./utils";
import { measureText } from "./text";

type Common = Partial<Omit<ExcalidrawElement, "type">>;

/** Base props, defaulting styles to the current item style in the store. */
const base = (type: string, props: Common, as: AppState = getState().appState) => ({
  id: randomId(),
  type,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  angle: 0,
  strokeColor: as.currentItemStrokeColor,
  backgroundColor: as.currentItemBackgroundColor,
  fillStyle: as.currentItemFillStyle,
  strokeWidth: as.currentItemStrokeWidth,
  strokeStyle: as.currentItemStrokeStyle,
  roughness: as.currentItemRoughness,
  roundness: as.currentItemRoundness,
  opacity: as.currentItemOpacity,
  seed: randomInteger(),
  version: 1,
  versionNonce: randomInteger(),
  updated: Date.now(),
  isDeleted: false,
  locked: false,
  groupIds: [],
  frameId: null,
  link: null,
  boundElements: [],
  ...props,
});

export const newShape = (type: ShapeType, props: Common = {}): ShapeElement =>
  base(type, props) as ShapeElement;

export const newText = (
  props: Common & Partial<Pick<TextElement, "text" | "fontSize" | "fontFamily" | "textAlign" | "verticalAlign" | "containerId">>,
): TextElement => {
  const as = getState().appState;
  const fontSize = props.fontSize ?? as.currentItemFontSize;
  const fontFamily = props.fontFamily ?? as.currentItemFontFamily;
  const text = props.text ?? "";
  const lineHeight = 1.25;
  const m = measureText(text, fontSize, fontFamily, lineHeight);
  return {
    ...(base("text", {}) as object),
    backgroundColor: "transparent",
    width: m.width,
    height: m.height,
    text,
    originalText: text,
    fontSize,
    fontFamily,
    textAlign: props.containerId ? "center" : as.currentItemTextAlign,
    verticalAlign: props.containerId ? "middle" : "top",
    lineHeight,
    containerId: null,
    autoResize: true,
    ...props,
  } as TextElement;
};

export const newLinear = (
  type: "arrow" | "line",
  props: Common & Partial<Pick<LinearElement, "points" | "startArrowhead" | "endArrowhead" | "arrowType" | "startBinding" | "endBinding" | "polygon">> = {},
): LinearElement => {
  const as = getState().appState;
  const points: Point[] = props.points ?? [[0, 0]];
  const el = {
    ...(base(type, {}) as object),
    points,
    startArrowhead: type === "arrow" ? as.currentItemStartArrowhead : null,
    endArrowhead: type === "arrow" ? as.currentItemEndArrowhead : null,
    arrowType: type === "arrow" ? as.currentItemArrowType : "sharp",
    startBinding: null,
    endBinding: null,
    polygon: false,
    ...props,
  } as LinearElement;
  return { ...el, ...linearSize(el.points) };
};

/** width/height derived from relative points. */
export const linearSize = (points: Point[]) => {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
};

export const newFreeDraw = (props: Common & Partial<Pick<FreeDrawElement, "points" | "pressures">> = {}): FreeDrawElement =>
  ({
    ...(base("freedraw", {}) as object),
    points: [[0, 0]],
    pressures: [],
    simulatePressure: true,
    backgroundColor: "transparent",
    ...props,
  }) as FreeDrawElement;

export const newImage = (props: Common & { fileId: string }): ImageElement =>
  ({
    ...(base("image", {}) as object),
    strokeColor: "transparent",
    backgroundColor: "transparent",
    scale: [1, 1],
    crop: null,
    ...props,
  }) as ImageElement;

export const newFrame = (props: Common & { name?: string | null } = {}): FrameElement =>
  ({
    ...(base("frame", {}) as object),
    strokeColor: "#bbb",
    backgroundColor: "transparent",
    strokeWidth: 2,
    roughness: 0,
    roundness: "sharp",
    name: null,
    ...props,
  }) as FrameElement;

export const newEmbeddable = (props: Common & { link: string }): EmbeddableElement =>
  ({
    ...(base("embeddable", {}) as object),
    backgroundColor: "transparent",
    roughness: 0,
    ...props,
  }) as EmbeddableElement;

/** Deep-clone elements with fresh ids, remapping groups, bindings, containers and frames. */
export function duplicateElements(
  elements: ExcalidrawElement[],
  offset: Point = [0, 0],
): ExcalidrawElement[] {
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  for (const el of elements) idMap.set(el.id, randomId());
  const mapGroup = (g: string) => {
    if (!groupMap.has(g)) groupMap.set(g, randomId());
    return groupMap.get(g)!;
  };
  return elements.map((el) => {
    const copy: any = structuredClone(el);
    copy.id = idMap.get(el.id);
    copy.x += offset[0];
    copy.y += offset[1];
    copy.seed = randomInteger();
    copy.version = 1;
    copy.versionNonce = randomInteger();
    copy.updated = Date.now();
    copy.groupIds = el.groupIds.map(mapGroup);
    copy.boundElements = el.boundElements
      .filter((b) => idMap.has(b.id))
      .map((b) => ({ ...b, id: idMap.get(b.id)! }));
    copy.frameId = el.frameId && idMap.has(el.frameId) ? idMap.get(el.frameId) : el.frameId;
    if (copy.containerId) copy.containerId = idMap.get(copy.containerId) ?? null;
    if (copy.startBinding)
      copy.startBinding = idMap.has(copy.startBinding.elementId)
        ? { ...copy.startBinding, elementId: idMap.get(copy.startBinding.elementId) }
        : null;
    if (copy.endBinding)
      copy.endBinding = idMap.has(copy.endBinding.elementId)
        ? { ...copy.endBinding, elementId: idMap.get(copy.endBinding.elementId) }
        : null;
    return copy as ExcalidrawElement;
  });
}

/**
 * Insert elements into the scene (on top), record history and select them.
 * The standard way for dialogs (mermaid, charts, library, paste) to add content.
 */
export function insertElements(
  elements: ExcalidrawElement[],
  opts: { select?: boolean; centerInView?: boolean } = { select: true, centerInView: true },
) {
  const s = getState();
  s.recordHistory();
  let els = elements;
  if (opts.centerInView !== false && els.length) {
    const minX = Math.min(...els.map((e) => e.x));
    const minY = Math.min(...els.map((e) => e.y));
    const maxX = Math.max(...els.map((e) => e.x + e.width));
    const maxY = Math.max(...els.map((e) => e.y + e.height));
    const { scrollX, scrollY, zoom, width, height } = s.appState;
    const cx = width / 2 / zoom - scrollX;
    const cy = height / 2 / zoom - scrollY;
    const dx = cx - (minX + maxX) / 2;
    const dy = cy - (minY + maxY) / 2;
    els = els.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }));
  }
  s.setElements([...s.elements, ...els]);
  if (opts.select !== false) {
    const sel: Record<string, true> = {};
    for (const e of els) if (!(e.type === "text" && (e as TextElement).containerId)) sel[e.id] = true;
    s.setAppState({ selectedElementIds: sel, activeTool: "selection" });
  }
  return els;
}

/** Bind a text element as the label of a container (shape or arrow). Mutates both objects. */
export function bindTextToContainer(container: ExcalidrawElement, text: TextElement) {
  text.containerId = container.id;
  text.textAlign = "center";
  text.verticalAlign = "middle";
  container.boundElements = [...container.boundElements, { id: text.id, type: "text" }];
}

/** Bind an arrow end to a shape. Mutates both objects. */
export function bindArrow(arrow: LinearElement, end: "start" | "end", target: ExcalidrawElement) {
  const binding = { elementId: target.id, fixedPoint: null, gap: 4 };
  if (end === "start") arrow.startBinding = binding;
  else arrow.endBinding = binding;
  if (!target.boundElements.some((b) => b.id === arrow.id))
    target.boundElements = [...target.boundElements, { id: arrow.id, type: "arrow" }];
}
