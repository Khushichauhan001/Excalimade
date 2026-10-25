// Pointer / wheel / keyboard interaction for the canvas: every tool and gesture lives here.
import type {
  ExcalidrawElement,
  FreeDrawElement,
  ImageElement,
  LinearElement,
  Point,
  ShapeType,
  TextElement,
  ToolType,
  Binding,
} from "../core/types";
import { SHAPE_TYPES } from "../core/types";
import { getState, getSelectedElements } from "../core/store";
import { newFrame, newFreeDraw, newLinear, newShape, newText, newEmbeddable } from "../core/elements";
import { getCommonBounds, getElementAbsCoords, getElementBounds, getElementCenter, isLinear } from "../core/geometry";
import { getBindingPoint, isBindable, routeElbow, updateBoundElements, withAbsolutePoints } from "../core/binding";
import { setZoom } from "../core/viewport";
import { emit } from "../core/events";
import { distance, randomInteger, rotatePoint, viewportToScene } from "../core/utils";
import { getDevice } from "../core/useDevice";
import { session, requestRepaint, type HandleName } from "./session";
import { getElementAtPoint, getElementsCrossingSegment, hitTest, getFrameNameBounds } from "./hit";
import { expandToGroups, getDependents, getElementsInBox, getSelectableGroupId, selectionFor } from "./selection";
import { getHandleAt, getHandles, getTransformBox, handleCursor, resizeMultiple, resizeSingle, rotateElements, usesPointHandles } from "./transform";
import { snapBounds, snapPointToGrid, snapToGrid } from "./snapping";
import { deleteElementsFrom, followLinkImpl, startTextEditingImpl, updateFrameMembership } from "./commands";
import { insertImages } from "./images";
import { refreshEmbeds } from "./embeds";
import { getLinkIconBounds } from "./interactive";

type El = ExcalidrawElement;

type Gesture =
  | { kind: "none" }
  | { kind: "pan"; startX: number; startY: number; scrollX: number; scrollY: number }
  | { kind: "create"; id: string; origin: Point }
  | { kind: "linear-create"; id: string; origin: Point; startBind: El | null }
  | { kind: "freedraw"; id: string }
  | { kind: "drag"; start: Point; originals: Map<string, El>; ids: Set<string>; moved: boolean; clickedId: string; wasSelected: boolean; shift: boolean }
  | { kind: "resize"; handle: HandleName; originals: El[] }
  | { kind: "rotate"; originals: El[]; startAngle: number }
  | { kind: "box"; start: Point; shift: boolean; base: Record<string, true> }
  | { kind: "erase"; last: Point }
  | { kind: "laser" }
  | { kind: "point-drag"; id: string; indices: number[]; start: Point; original: LinearElement; moved: boolean }
  | { kind: "crop"; handle: HandleName | "move"; original: ImageElement; start: Point }
  | { kind: "pinch"; d0: number; c0: Point; zoom0: number; scroll0: Point };

const SHAPE_TOOLS = new Set<ToolType>(SHAPE_TYPES);
const DRAG_THRESHOLD = 3;

export class PointerController {
  gesture: Gesture = { kind: "none" };
  pointers = new Map<number, Point>(); // client coords of active pointers
  lastDown = { t: 0, x: 0, y: 0 };
  downClient: Point = [0, 0];
  longPressTimer: ReturnType<typeof setTimeout> | undefined;
  cursor = "default";
  setCursor: (c: string) => void = () => {};
  spaceHeld = false;

  private get s() {
    return getState();
  }

  private scene(e: { clientX: number; clientY: number }): Point {
    return viewportToScene(e.clientX, e.clientY, this.s.appState);
  }

  private replace(changed: El[], extraIds: Iterable<string> = []) {
    const s = this.s;
    const map = new Map(changed.map((e) => [e.id, e]));
    let next = s.elements.map((e) => {
      const c = map.get(e.id);
      return c ? ({ ...c, version: e.version + 1, versionNonce: randomInteger(), updated: Date.now() } as El) : e;
    });
    next = updateBoundElements(next, [...map.keys(), ...extraIds]);
    s.setElements(next);
  }

  private snapEnabled(e: { ctrlKey: boolean; metaKey: boolean }) {
    // holding Ctrl/Cmd toggles object snapping, like Excalidraw
    return this.s.appState.objectsSnapModeEnabled !== (e.ctrlKey || e.metaKey);
  }

  private gridPoint(p: Point, e: { ctrlKey: boolean; metaKey: boolean }): Point {
    const as = this.s.appState;
    return as.gridModeEnabled && !(e.ctrlKey || e.metaKey) ? snapPointToGrid(p, as.gridSize) : p;
  }

  // ------------------------------------------------------------------ binding helpers
  private bindableAt(p: Point, excludeId?: string, e?: { ctrlKey: boolean; metaKey: boolean }): El | null {
    if (e && (e.ctrlKey || e.metaKey)) return null;
    const s = this.s;
    const tol = 14 / s.appState.zoom;
    for (let i = s.elements.length - 1; i >= 0; i--) {
      const el = s.elements[i];
      if (el.id === excludeId || !isBindable(el) || el.locked) continue;
      if (hitTest(el, p, tol, el.type !== "frame", s.appState.zoom)) return el;
    }
    return null;
  }

  /** For elbow arrows: anchor at the midpoint of the side facing `towards`. */
  private elbowFixedPoint(target: El, towards: Point): Point {
    const c = getElementCenter(target);
    const local = rotatePoint(towards, c, -target.angle);
    const dx = (local[0] - c[0]) / Math.max(target.width, 1);
    const dy = (local[1] - c[1]) / Math.max(target.height, 1);
    if (Math.abs(dx) > Math.abs(dy)) return [dx > 0 ? 1 : 0, 0.5];
    return [0.5, dy > 0 ? 1 : 0];
  }

  private makeBinding(arrow: LinearElement, target: El, towards: Point): Binding {
    return { elementId: target.id, fixedPoint: arrow.arrowType === "elbow" ? this.elbowFixedPoint(target, towards) : null, gap: 6 };
  }

  /** Link/unlink an arrow end in both directions (arrow binding + target.boundElements). */
  private applyBinding(elements: El[], arrowId: string, end: "start" | "end", target: El | null, towards: Point): El[] {
    const arrow = elements.find((e) => e.id === arrowId) as LinearElement;
    const key = end === "start" ? "startBinding" : "endBinding";
    const prev = arrow[key];
    const binding = target ? this.makeBinding(arrow, target, towards) : null;
    const otherEnd = end === "start" ? arrow.endBinding : arrow.startBinding;
    return elements.map((el) => {
      if (el.id === arrowId) return { ...el, [key]: binding } as El;
      let be = el.boundElements;
      if (prev && el.id === prev.elementId && !(otherEnd && otherEnd.elementId === el.id) && (!target || target.id !== el.id)) {
        be = be.filter((b) => b.id !== arrowId);
      }
      if (target && el.id === target.id && !be.some((b) => b.id === arrowId)) be = [...be, { id: arrowId, type: "arrow" }];
      return be === el.boundElements ? el : ({ ...el, boundElements: be, version: el.version + 1 } as El);
    });
  }

  // ------------------------------------------------------------------ pointer down
  onPointerDown = (e: PointerEvent) => {
    const s = this.s;
    const as = s.appState;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (as.contextMenu || as.openMenu) s.setAppState({ contextMenu: null, openMenu: null });
    if (session.activeEmbedId) {
      session.activeEmbedId = null;
      refreshEmbeds();
    }
    // commit any open text editor before doing anything else
    if (as.editingTextId) (document.activeElement as HTMLElement | null)?.blur();

    if (this.pointers.size === 2) return this.startPinch();
    if (this.pointers.size > 2) return;

    this.downClient = [e.clientX, e.clientY];
    const p = this.scene(e);
    session.lastPointer = p;

    // long-press → context menu on touch
    if (e.pointerType === "touch") {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = setTimeout(() => {
        if (this.gesture.kind === "none" || this.gesture.kind === "box" || (this.gesture.kind === "drag" && !this.gesture.moved)) {
          this.cancelGesture();
          this.openContextMenu(e.clientX, e.clientY, p);
        }
      }, 550);
    }

    const tool = as.activeTool;
    const isDouble = performance.now() - this.lastDown.t < 350 && Math.hypot(e.clientX - this.lastDown.x, e.clientY - this.lastDown.y) < 10;
    this.lastDown = { t: isDouble ? 0 : performance.now(), x: e.clientX, y: e.clientY };

    if (e.button === 1 || (e.button === 0 && (tool === "hand" || this.spaceHeld))) return this.startPan(e);
    if (e.button === 2) return; // context menu handled separately

    const readOnly = as.viewModeEnabled || !!as.presentationMode;
    if (readOnly && tool !== "laser") {
      const hit = getElementAtPoint(s.elements, p, as.zoom, { includeLocked: true });
      if (hit?.link) return followLinkImpl(hit.link);
      return this.startPan(e);
    }

    if (isDouble && tool === "selection") return this.onDoubleClick(p, e);

    switch (tool) {
      case "laser":
        this.gesture = { kind: "laser" };
        session.laserTrail.push({ x: p[0], y: p[1], t: performance.now() });
        requestRepaint();
        return;
      case "eraser":
        s.recordHistory();
        this.gesture = { kind: "erase", last: p };
        this.eraseAlong(p, p);
        return;
      case "text":
        return this.createTextAt(p, e);
      case "image":
        return this.pickImage(e);
      case "freedraw":
        return this.startFreeDraw(p, e);
      case "arrow":
      case "line":
        return this.linearDown(p, e, tool);
      case "selection":
        return this.selectionDown(p, e);
      default:
        if (SHAPE_TOOLS.has(tool) || tool === "frame" || tool === "embeddable") return this.startCreate(p, e, tool);
    }
  };

  private startPan(e: PointerEvent) {
    const as = this.s.appState;
    this.gesture = { kind: "pan", startX: e.clientX, startY: e.clientY, scrollX: as.scrollX, scrollY: as.scrollY };
    this.setCursor("grabbing");
  }

  private startPinch() {
    if (this.gesture.kind === "create" || this.gesture.kind === "linear-create" || this.gesture.kind === "freedraw") {
      // a second finger means the user wants to zoom, not draw: drop the half-made element
      const id = this.gesture.id;
      this.s.setElements(this.s.elements.filter((el) => el.id !== id));
    }
    clearTimeout(this.longPressTimer);
    const [a, b] = [...this.pointers.values()];
    const as = this.s.appState;
    this.gesture = {
      kind: "pinch",
      d0: distance(a, b) || 1,
      c0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      zoom0: as.zoom,
      scroll0: [as.scrollX, as.scrollY],
    };
  }

  private cancelGesture() {
    session.boxSelection = null;
    session.snapLines = [];
    this.gesture = { kind: "none" };
    requestRepaint();
  }

  openContextMenu(x: number, y: number, p: Point) {
    const s = this.s;
    const hit = getElementAtPoint(s.elements, p, s.appState.zoom, { selectedIds: s.appState.selectedElementIds, includeLocked: true });
    if (hit && !s.appState.selectedElementIds[hit.id]) s.setAppState({ selectedElementIds: selectionFor(hit, s.elements, s.appState) });
    if (!hit) s.setAppState({ selectedElementIds: {} });
    s.setAppState({ contextMenu: { x, y } });
  }

  onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (this.s.appState.presentationMode) return;
    this.openContextMenu(e.clientX, e.clientY, this.scene(e));
  };

  // ------------------------------------------------------------------ selection tool
  private selectionDown(p: Point, e: PointerEvent) {
    const s = this.s;
    const as = s.appState;
    const zoom = as.zoom;
    const touch = e.pointerType === "touch";
    const selected = getSelectedElements(s);

    // image crop mode
    if (as.croppingImageId) {
      const img = s.elements.find((x) => x.id === as.croppingImageId) as ImageElement | undefined;
      if (img) {
        const handle = getHandleAt(getHandles(getTransformBox([img])!, zoom, { rotation: false }), p, zoom, touch);
        if (handle && handle !== "rotation") {
          s.recordHistory();
          this.gesture = { kind: "crop", handle, original: img, start: p };
          return;
        }
        if (hitTest(img, p, 0, true, zoom)) {
          s.recordHistory();
          this.gesture = { kind: "crop", handle: "move", original: img, start: p };
          return;
        }
      }
      s.setAppState({ croppingImageId: null });
    }

    // linear point handles (editor mode, or a selected 2-point line/arrow)
    const linear =
      (as.editingLinearId && (s.elements.find((x) => x.id === as.editingLinearId) as LinearElement | undefined)) ||
      (selected.length === 1 && usesPointHandles(selected[0]) && !selected[0].locked ? (selected[0] as LinearElement) : undefined);
    if (linear) {
      const idx = this.pointHandleAt(linear, p, touch);
      if (idx !== null) {
        s.recordHistory();
        let indices = [idx];
        if (as.editingLinearId) {
          if (e.shiftKey) session.linearSelectedPoints = [...new Set([...session.linearSelectedPoints, idx])];
          else if (!session.linearSelectedPoints.includes(idx)) session.linearSelectedPoints = [idx];
          indices = session.linearSelectedPoints;
        }
        this.gesture = { kind: "point-drag", id: linear.id, indices, start: p, original: linear, moved: false };
        return;
      }
      const mid = linear.arrowType === "elbow" ? null : this.midpointHandleAt(linear, p, touch);
      if (mid !== null) {
        s.recordHistory();
        const abs = linear.points.map(([px, py]) => [linear.x + px, linear.y + py] as Point);
        abs.splice(mid + 1, 0, p);
        const updated = withAbsolutePoints(linear, abs);
        this.replace([updated]);
        session.linearSelectedPoints = [mid + 1];
        this.gesture = { kind: "point-drag", id: linear.id, indices: [mid + 1], start: p, original: updated, moved: false };
        return;
      }
      if (as.editingLinearId && !hitTest(linear, p, 6 / zoom, false, zoom)) {
        s.setAppState({ editingLinearId: null });
        session.linearSelectedPoints = [];
      }
    }

    // transform handles
    const unlocked = selected.filter((x) => !x.locked);
    const box = unlocked.length === selected.length ? getTransformBox(unlocked) : null;
    if (box) {
      const single = unlocked.length === 1 ? unlocked[0] : null;
      const handles = getHandles(box, zoom, {
        vertical: !(single?.type === "text"),
        rotation: !(single?.type === "frame") && !(single && single.type === "text" && (single as TextElement).containerId),
      });
      const handle = getHandleAt(handles, p, zoom, touch);
      if (handle) {
        s.recordHistory();
        const originals = this.withLabels(unlocked);
        if (handle === "rotation") {
          const c: Point = [box.x + box.w / 2, box.y + box.h / 2];
          this.gesture = { kind: "rotate", originals, startAngle: Math.atan2(p[1] - c[1], p[0] - c[0]) };
        } else {
          this.gesture = { kind: "resize", handle, originals };
        }
        return;
      }
    }

    // link icon of a single selected element
    if (selected.length === 1 && selected[0].link) {
      const b = getLinkIconBounds(selected[0], zoom);
      if (p[0] >= b.x && p[0] <= b.x + b.size && p[1] >= b.y && p[1] <= b.y + b.size) {
        followLinkImpl(selected[0].link);
        return;
      }
    }

    const hit = getElementAtPoint(s.elements, p, zoom, { selectedIds: as.selectedElementIds });
    if (hit) {
      if (hit.link && (e.ctrlKey || e.metaKey)) return followLinkImpl(hit.link);
      // leaving an entered group by clicking outside it
      if (as.editingGroupId && !hit.groupIds.includes(as.editingGroupId)) s.setAppState({ editingGroupId: null });
      const wasSelected = !!s.appState.selectedElementIds[hit.id];
      let ids = s.appState.selectedElementIds;
      if (e.shiftKey) {
        const groupIds = selectionFor(hit, s.elements, s.appState);
        ids = { ...ids };
        if (wasSelected) for (const id of Object.keys(groupIds)) delete ids[id];
        else Object.assign(ids, groupIds);
      } else if (!wasSelected) {
        ids = selectionFor(hit, s.elements, s.appState);
      }
      s.setAppState({ selectedElementIds: ids, editingLinearId: as.editingLinearId === hit.id ? as.editingLinearId : null });
      if (e.shiftKey && wasSelected) return;
      const moving = s.elements.filter((x) => ids[x.id] && !x.isDeleted && !x.locked);
      const all = new Set(moving.map((x) => x.id));
      for (const d of getDependents(all, s.elements)) all.add(d);
      const originals = new Map(s.elements.filter((x) => all.has(x.id)).map((x) => [x.id, x]));
      this.gesture = { kind: "drag", start: p, originals, ids: all, moved: false, clickedId: hit.id, wasSelected, shift: e.shiftKey };
      return;
    }

    // empty canvas → box selection
    if (!e.shiftKey) {
      s.setAppState({ selectedElementIds: {}, editingGroupId: null, editingLinearId: null });
      session.linearSelectedPoints = [];
    }
    this.gesture = { kind: "box", start: p, shift: e.shiftKey, base: e.shiftKey ? as.selectedElementIds : {} };
  }

  /** Include bound labels so resize/rotate keep them in sync. */
  private withLabels(els: El[]) {
    return els;
  }

  private pointHandleAt(el: LinearElement, p: Point, touch: boolean): number | null {
    const r = (touch ? 16 : 9) / this.s.appState.zoom;
    const c = getElementCenter(el);
    for (let i = el.points.length - 1; i >= 0; i--) {
      const abs = rotatePoint([el.x + el.points[i][0], el.y + el.points[i][1]], c, el.angle);
      if (distance(abs, p) <= r) return i;
    }
    return null;
  }

  private midpointHandleAt(el: LinearElement, p: Point, touch: boolean): number | null {
    const zoom = this.s.appState.zoom;
    const r = (touch ? 14 : 7) / zoom;
    const c = getElementCenter(el);
    for (let i = 0; i < el.points.length - 1; i++) {
      const a = el.points[i], b = el.points[i + 1];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) * zoom < 36) continue;
      const mid = rotatePoint([el.x + (a[0] + b[0]) / 2, el.y + (a[1] + b[1]) / 2], c, el.angle);
      if (distance(mid, p) <= r) return i;
    }
    return null;
  }

  // ------------------------------------------------------------------ double click
  private onDoubleClick(p: Point, e: PointerEvent) {
    const s = this.s;
    const as = s.appState;
    const zoom = as.zoom;
    // frame name label
    for (let i = s.elements.length - 1; i >= 0; i--) {
      const f = s.elements[i];
      if (f.type !== "frame" || f.isDeleted) continue;
      const nb = getFrameNameBounds(f as any, zoom);
      if (p[0] >= nb.x && p[0] <= nb.x + nb.w && p[1] >= nb.y && p[1] <= nb.y + nb.h) {
        s.setAppState({ editingFrameNameId: f.id, selectedElementIds: { [f.id]: true } });
        return;
      }
    }
    const hit = getElementAtPoint(s.elements, p, zoom, { selectedIds: as.selectedElementIds });
    if (!hit) {
      this.createTextAt(p, e);
      return;
    }
    const gid = getSelectableGroupId(hit, as.editingGroupId);
    if (gid && hit.groupIds.length && hit.type !== "text") {
      // enter the group; a further double-click edits the element
      const inner = hit.groupIds.indexOf(gid);
      s.setAppState({ editingGroupId: gid, selectedElementIds: inner > 0 ? selectionFor(hit, s.elements, { editingGroupId: gid }) : { [hit.id]: true } });
      return;
    }
    switch (hit.type) {
      case "line":
        s.setAppState({ editingLinearId: hit.id, selectedElementIds: { [hit.id]: true } });
        session.linearSelectedPoints = [];
        return;
      case "image":
        this.startCrop(hit as ImageElement);
        return;
      case "embeddable":
        session.activeEmbedId = hit.id;
        refreshEmbeds();
        return;
      case "freedraw":
        return;
      case "frame":
        s.setAppState({ editingFrameNameId: hit.id });
        return;
      default:
        startTextEditingImpl(hit.id);
    }
  }

  startCrop(img: ImageElement) {
    const s = this.s;
    s.setAppState({ croppingImageId: img.id, selectedElementIds: { [img.id]: true } });
  }

  // ------------------------------------------------------------------ creation
  private finishTool(id: string | null) {
    const s = this.s;
    if (!s.appState.toolLocked) s.setAppState({ activeTool: "selection" });
    if (id) s.setAppState({ selectedElementIds: { [id]: true } });
  }

  private startCreate(p0: Point, e: PointerEvent, tool: ToolType) {
    const s = this.s;
    const p = this.gridPoint(p0, e);
    s.recordHistory();
    let el: El;
    if (tool === "frame") el = newFrame({ x: p[0], y: p[1] });
    else if (tool === "embeddable") el = newEmbeddable({ x: p[0], y: p[1], link: "" });
    else el = newShape(tool as ShapeType, { x: p[0], y: p[1] });
    if (tool === "embeddable") (el as any).link = null;
    s.setElements([...s.elements, el]);
    s.setAppState({ selectedElementIds: {} });
    this.gesture = { kind: "create", id: el.id, origin: p };
  }

  private createTextAt(p0: Point, e: PointerEvent | { ctrlKey: boolean; metaKey: boolean }) {
    const s = this.s;
    if (s.appState.viewModeEnabled) return;
    const p = this.gridPoint(p0, e);
    const zoom = s.appState.zoom;
    // clicking a shape with the text tool edits its label
    const hit = getElementAtPoint(s.elements, p, zoom);
    if (hit && (SHAPE_TOOLS.has(hit.type as ToolType) || hit.type === "text" || hit.type === "arrow")) {
      startTextEditingImpl(hit.id);
      if (!s.appState.toolLocked) s.setAppState({ activeTool: "selection" });
      return;
    }
    s.recordHistory();
    const as = s.appState;
    const t = newText({ text: "", x: p[0], y: p[1] - (as.currentItemFontSize * 1.25) / 2 });
    s.setElements([...s.elements, { ...t, frameId: null }]);
    s.setAppState({ editingTextId: t.id, selectedElementIds: { [t.id]: true } });
    if (!as.toolLocked) s.setAppState({ activeTool: "selection" });
  }

  private pickImage(e: PointerEvent) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    const point = { x: e.clientX, y: e.clientY };
    input.onchange = () => {
      if (input.files?.length) void insertImages([...input.files], point);
    };
    input.click();
  }

  private startFreeDraw(p: Point, e: PointerEvent) {
    const s = this.s;
    s.recordHistory();
    const el = newFreeDraw({
      x: p[0],
      y: p[1],
      points: [[0, 0]],
      pressures: [e.pointerType === "pen" ? e.pressure : 0.5],
      simulatePressure: e.pointerType !== "pen",
    } as Partial<FreeDrawElement>);
    s.setElements([...s.elements, el]);
    s.setAppState({ selectedElementIds: {} });
    this.gesture = { kind: "freedraw", id: el.id };
  }

  private linearDown(p0: Point, e: PointerEvent, tool: "arrow" | "line") {
    const s = this.s;
    const p = this.gridPoint(p0, e);
    const mp = session.multiPoint;
    if (mp) {
      const el = s.elements.find((x) => x.id === mp.id) as LinearElement | undefined;
      if (!el) {
        session.multiPoint = null;
      } else {
        const pts = el.points;
        const committed = pts.slice(0, -1); // last point is the floating cursor
        const first: Point = [el.x + committed[0][0], el.y + committed[0][1]];
        const last: Point = [el.x + committed[committed.length - 1][0], el.y + committed[committed.length - 1][1]];
        const r = 12 / s.appState.zoom;
        if (el.type === "line" && committed.length >= 3 && distance(p, first) <= r) {
          // close the polygon
          const abs = committed.map(([px, py]) => [el.x + px, el.y + py] as Point);
          abs.push(first);
          this.replace([{ ...withAbsolutePoints(el, abs), polygon: true }]);
          this.finishMultiPoint(true);
          return;
        }
        if (distance(p, last) <= r) {
          this.finishMultiPoint();
          return;
        }
        // commit the floating point and add a new floating one
        const abs = [...committed, [p[0] - el.x, p[1] - el.y] as Point].map(([px, py]) => [el.x + px, el.y + py] as Point);
        abs.push(p);
        this.replace([withAbsolutePoints(el, abs)]);
        return;
      }
    }
    s.recordHistory();
    const startBind = tool === "arrow" ? this.bindableAt(p, undefined, e) : null;
    const el = newLinear(tool, { x: p[0], y: p[1], points: [[0, 0], [0, 0]] });
    s.setElements([...s.elements, el]);
    s.setAppState({ selectedElementIds: {} });
    this.gesture = { kind: "linear-create", id: el.id, origin: p, startBind };
  }

  /** Finish a click-by-click line/arrow. */
  finishMultiPoint(alreadyClosed = false) {
    const s = this.s;
    const mp = session.multiPoint;
    session.multiPoint = null;
    session.bindTarget = null;
    if (!mp) return;
    const el = s.elements.find((x) => x.id === mp.id) as LinearElement | undefined;
    if (!el) return;
    let abs = el.points.map(([px, py]) => [el.x + px, el.y + py] as Point);
    if (!alreadyClosed) abs = abs.slice(0, -1); // drop floating point
    // drop consecutive duplicates
    abs = abs.filter((p, i) => i === 0 || distance(p, abs[i - 1]) > 0.5);
    if (abs.length < 2) {
      s.setElements(s.elements.filter((x) => x.id !== el.id));
      return;
    }
    let updated: El = alreadyClosed ? el : withAbsolutePoints(el, abs);
    let next = s.elements.map((x) => (x.id === el.id ? updated : x));
    if (el.type === "arrow" && !alreadyClosed) {
      const end = abs[abs.length - 1];
      const target = this.bindableAt(end, el.id);
      if (target) {
        next = this.applyBinding(next, el.id, "end", target, end);
        next = updateBoundElements(next, [el.id]);
      }
    }
    next = updateFrameMembership(next, [el.id]);
    s.setElements(next);
    this.finishTool(el.id);
    requestRepaint();
  }

  // ------------------------------------------------------------------ pointer move
  onPointerMove = (e: PointerEvent) => {
    const s = this.s;
    const as = s.appState;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
    const p = this.scene(e);
    session.lastPointer = p;
    emit("pointer", { x: p[0], y: p[1], tool: as.activeTool, down: this.pointers.size > 0 });
    if (this.longPressTimer && Math.hypot(e.clientX - this.downClient[0], e.clientY - this.downClient[1]) > 8) clearTimeout(this.longPressTimer);

    const g = this.gesture;
    switch (g.kind) {
      case "none":
        if (session.multiPoint) this.moveMultiPoint(p, e);
        else this.updateHoverCursor(p, e);
        return;
      case "pinch": {
        if (this.pointers.size < 2) return;
        const [a, b] = [...this.pointers.values()];
        const d = distance(a, b);
        const c: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const zoom = Math.min(30, Math.max(0.1, (g.zoom0 * d) / g.d0));
        // keep the scene point under the initial centre under the current centre
        const sx = g.c0[0] / g.zoom0 - g.scroll0[0];
        const sy = g.c0[1] / g.zoom0 - g.scroll0[1];
        s.setAppState({ zoom, scrollX: c[0] / zoom - sx, scrollY: c[1] / zoom - sy });
        return;
      }
      case "pan":
        s.setAppState({ scrollX: g.scrollX + (e.clientX - g.startX) / as.zoom, scrollY: g.scrollY + (e.clientY - g.startY) / as.zoom });
        return;
      case "laser":
        session.laserTrail.push({ x: p[0], y: p[1], t: performance.now() });
        requestRepaint();
        return;
      case "erase":
        this.eraseAlong(g.last, p);
        g.last = p;
        return;
      case "freedraw": {
        const el = s.elements.find((x) => x.id === g.id) as FreeDrawElement | undefined;
        if (!el) return;
        const rel: Point = [p[0] - el.x, p[1] - el.y];
        const lastP = el.points[el.points.length - 1];
        if (distance(rel, lastP) < 0.8 / as.zoom) return;
        const points = [...el.points, rel];
        const pressures = [...el.pressures, e.pointerType === "pen" ? e.pressure : 0.5];
        const xs = points.map((q) => q[0]), ys = points.map((q) => q[1]);
        s.setElements(
          s.elements.map((x) =>
            x.id === g.id ? ({ ...el, points, pressures, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) } as El) : x,
          ),
        );
        return;
      }
      case "create":
        return this.moveCreate(g, p, e);
      case "linear-create":
        return this.moveLinearCreate(g, p, e);
      case "drag":
        return this.moveDrag(g, p, e);
      case "resize": {
        const mods = { shift: e.shiftKey, alt: e.altKey };
        const pp = this.gridPoint(p, e);
        const changed = g.originals.length === 1 ? [resizeSingle(g.originals[0], g.handle, pp, mods)] : resizeMultiple(g.originals, g.handle, pp, mods);
        this.replace(changed);
        session.isDragging = true;
        return;
      }
      case "rotate":
        this.replace(rotateElements(g.originals, p, g.startAngle, e.shiftKey));
        session.isDragging = true;
        return;
      case "box": {
        session.boxSelection = { x1: g.start[0], y1: g.start[1], x2: p[0], y2: p[1] };
        const box: [number, number, number, number] = [Math.min(g.start[0], p[0]), Math.min(g.start[1], p[1]), Math.max(g.start[0], p[0]), Math.max(g.start[1], p[1])];
        const ids = getElementsInBox(s.elements, box, as.editingGroupId);
        s.setAppState({ selectedElementIds: { ...g.base, ...ids } });
        requestRepaint();
        return;
      }
      case "point-drag":
        return this.movePoints(g, p, e);
      case "crop":
        return this.moveCrop(g, p, e);
    }
  };

  private updateHoverCursor(p: Point, e: PointerEvent) {
    const s = this.s;
    const as = s.appState;
    const tool = as.activeTool;
    let cursor = "default";
    if (this.spaceHeld || tool === "hand") cursor = "grab";
    else if (as.viewModeEnabled || as.presentationMode) {
      const hit = getElementAtPoint(s.elements, p, as.zoom, { includeLocked: true });
      cursor = tool === "laser" ? LASER_CURSOR : hit?.link ? "pointer" : "grab";
    } else if (tool === "eraser") cursor = ERASER_CURSOR;
    else if (tool === "laser") cursor = LASER_CURSOR;
    else if (tool === "text") cursor = "text";
    else if (tool !== "selection") cursor = "crosshair";
    else {
      const selected = getSelectedElements(s).filter((x) => !x.locked);
      const box = getTransformBox(selected);
      const handle = box ? getHandleAt(getHandles(box, as.zoom, { vertical: !(selected.length === 1 && selected[0].type === "text") }), p, as.zoom) : null;
      if (handle) cursor = handleCursor(handle, box!.angle);
      else {
        const linear = as.editingLinearId ? (s.elements.find((x) => x.id === as.editingLinearId) as LinearElement) : selected.length === 1 && usesPointHandles(selected[0]) ? (selected[0] as LinearElement) : null;
        const pointIdx = linear ? this.pointHandleAt(linear, p, false) : null;
        if (session.hoveredLinearPoint !== pointIdx) {
          session.hoveredLinearPoint = pointIdx;
          requestRepaint();
        }
        if (pointIdx !== null) cursor = "pointer";
        else {
          const hit = getElementAtPoint(s.elements, p, as.zoom, { selectedIds: as.selectedElementIds });
          if (hit) cursor = hit.link && (e.ctrlKey || e.metaKey) ? "pointer" : "move";
          if (selected.length === 1 && selected[0].link) {
            const b = getLinkIconBounds(selected[0], as.zoom);
            if (p[0] >= b.x && p[0] <= b.x + b.size && p[1] >= b.y && p[1] <= b.y + b.size) cursor = "pointer";
          }
        }
      }
    }
    if (cursor !== this.cursor) {
      this.cursor = cursor;
      this.setCursor(cursor);
    }
  }

  private moveCreate(g: Extract<Gesture, { kind: "create" }>, p0: Point, e: PointerEvent) {
    const s = this.s;
    const el = s.elements.find((x) => x.id === g.id);
    if (!el) return;
    let p = this.gridPoint(p0, e);
    session.snapLines = [];
    if (this.snapEnabled(e) && !s.appState.gridModeEnabled) {
      const r = snapBounds([p[0], p[1], p[0], p[1]], s.elements, new Set([el.id]), s.appState);
      p = [p[0] + r.dx, p[1] + r.dy];
      session.snapLines = r.lines;
    }
    let w = p[0] - g.origin[0];
    let h = p[1] - g.origin[1];
    if (e.shiftKey) {
      const m = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * m;
      h = Math.sign(h || 1) * m;
    }
    let x = g.origin[0], y = g.origin[1];
    if (e.altKey) {
      x -= w;
      y -= h;
      w *= 2;
      h *= 2;
    }
    const patch = { x: Math.min(x, x + w), y: Math.min(y, y + h), width: Math.abs(w), height: Math.abs(h) };
    s.setElements(s.elements.map((x2) => (x2.id === el.id ? ({ ...el, ...patch } as El) : x2)));
    session.isDragging = true;
  }

  private moveLinearCreate(g: Extract<Gesture, { kind: "linear-create" }>, p0: Point, e: PointerEvent) {
    const s = this.s;
    const el = s.elements.find((x) => x.id === g.id) as LinearElement | undefined;
    if (!el) return;
    let p = this.gridPoint(p0, e);
    if (e.shiftKey && el.arrowType !== "elbow") p = this.angleSnap(g.origin, p);
    const endBind = el.type === "arrow" ? this.bindableAt(p, el.id, e) : null;
    session.bindTarget = endBind?.id ?? null;
    let start = g.origin;
    let end = p;
    if (el.arrowType === "elbow") {
      const sb = g.startBind ? getBindingPoint(g.startBind, this.makeBinding(el, g.startBind, p), p) : null;
      const eb = endBind ? getBindingPoint(endBind, this.makeBinding(el, endBind, g.origin), g.origin) : null;
      const route = routeElbow(sb?.point ?? start, sb?.heading ?? null, eb?.point ?? end, eb?.heading ?? null);
      s.setElements(s.elements.map((x) => (x.id === el.id ? withAbsolutePoints(el, route) : x)));
      session.isDragging = true;
      return;
    }
    if (g.startBind && g.startBind.id !== endBind?.id) start = getBindingPoint(g.startBind, { elementId: g.startBind.id, fixedPoint: null, gap: 6 }, endBind ? getElementCenter(endBind) : p).point;
    if (endBind) end = getBindingPoint(endBind, { elementId: endBind.id, fixedPoint: null, gap: 6 }, g.startBind ? getElementCenter(g.startBind) : start).point;
    s.setElements(s.elements.map((x) => (x.id === el.id ? withAbsolutePoints(el, [start, end]) : x)));
    session.isDragging = true;
  }

  private angleSnap(origin: Point, p: Point): Point {
    const dx = p[0] - origin[0], dy = p[1] - origin[1];
    const len = Math.hypot(dx, dy);
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
    return [origin[0] + Math.cos(a) * len, origin[1] + Math.sin(a) * len];
  }

  private moveMultiPoint(p0: Point, e: PointerEvent) {
    const s = this.s;
    const mp = session.multiPoint!;
    const el = s.elements.find((x) => x.id === mp.id) as LinearElement | undefined;
    if (!el) return;
    let p = this.gridPoint(p0, e);
    const committed = el.points.slice(0, -1);
    const lastAbs: Point = [el.x + committed[committed.length - 1][0], el.y + committed[committed.length - 1][1]];
    if (e.shiftKey) p = this.angleSnap(lastAbs, p);
    const target = el.type === "arrow" ? this.bindableAt(p, el.id, e) : null;
    session.bindTarget = target?.id ?? null;
    mp.cursor = p;
    const abs = el.points.map(([px, py]) => [el.x + px, el.y + py] as Point);
    abs[abs.length - 1] = p;
    s.setElements(s.elements.map((x) => (x.id === el.id ? withAbsolutePoints(el, abs) : x)));
    this.setCursor("crosshair");
  }

  private moveDrag(g: Extract<Gesture, { kind: "drag" }>, p: Point, e: PointerEvent) {
    const s = this.s;
    const as = s.appState;
    if (!g.moved) {
      if (Math.hypot(e.clientX - this.downClient[0], e.clientY - this.downClient[1]) < DRAG_THRESHOLD) return;
      if (!g.ids.size) return;
      g.moved = true;
      s.recordHistory();
      session.isDragging = true;
      // Alt-drag duplicates: originals stay, copies move
      if (e.altKey) this.duplicateForDrag(g);
    }
    let dx = p[0] - g.start[0];
    let dy = p[1] - g.start[1];
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    const origs = [...g.originals.values()].filter((x) => !(x.type === "text" && (x as TextElement).containerId && g.ids.has((x as TextElement).containerId!)) || true);
    const movers = origs.filter((x) => as.selectedElementIds[x.id]);
    const [bx1, by1, bx2, by2] = getCommonBounds(movers.length ? movers : origs);
    session.snapLines = [];
    if (as.gridModeEnabled && !(e.ctrlKey || e.metaKey)) {
      dx = snapToGrid(bx1 + dx, as.gridSize) - bx1;
      dy = snapToGrid(by1 + dy, as.gridSize) - by1;
    } else if (this.snapEnabled(e)) {
      const r = snapBounds([bx1 + dx, by1 + dy, bx2 + dx, by2 + dy], s.elements, g.ids, as);
      dx += r.dx;
      dy += r.dy;
      session.snapLines = r.lines;
    }
    const changed = origs.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy }));
    // frame drop target highlight
    const nonFrames = movers.filter((x) => x.type !== "frame");
    session.frameTarget = null;
    if (nonFrames.length) {
      const b = getCommonBounds(nonFrames).map((v, i) => v + (i % 2 === 0 ? dx : dy));
      for (let i = s.elements.length - 1; i >= 0; i--) {
        const f = s.elements[i];
        if (f.type === "frame" && !f.isDeleted && !g.ids.has(f.id) && b[0] >= f.x && b[1] >= f.y && b[2] <= f.x + f.width && b[3] <= f.y + f.height) {
          session.frameTarget = f.id;
          break;
        }
      }
    }
    this.replace(changed);
  }

  private duplicateForDrag(g: Extract<Gesture, { kind: "drag" }>) {
    const s = this.s;
    const idMap = new Map<string, string>();
    for (const id of g.ids) idMap.set(id, Math.random().toString(36).slice(2, 12) + Date.now().toString(36));
    const groupMap = new Map<string, string>();
    const mapGroup = (gid: string) => {
      if (!groupMap.has(gid)) groupMap.set(gid, Math.random().toString(36).slice(2, 12));
      return groupMap.get(gid)!;
    };
    // the copies stay where the originals were; the originals (which keep their bindings) move
    const copies: El[] = [];
    for (const o of g.originals.values()) {
      const c: any = structuredClone(o);
      c.id = idMap.get(o.id);
      c.seed = randomInteger();
      c.version = 1;
      c.groupIds = o.groupIds.map(mapGroup);
      c.boundElements = o.boundElements.filter((b) => idMap.has(b.id)).map((b) => ({ ...b, id: idMap.get(b.id)! }));
      if (c.containerId) c.containerId = idMap.get(c.containerId) ?? null;
      if (c.frameId && idMap.has(c.frameId)) c.frameId = idMap.get(c.frameId);
      if (c.startBinding) c.startBinding = idMap.has(c.startBinding.elementId) ? { ...c.startBinding, elementId: idMap.get(c.startBinding.elementId) } : null;
      if (c.endBinding) c.endBinding = idMap.has(c.endBinding.elementId) ? { ...c.endBinding, elementId: idMap.get(c.endBinding.elementId) } : null;
      copies.push(c);
    }
    // insert copies just below the topmost original so the moving originals stay on top
    const firstIdx = Math.min(...[...g.ids].map((id) => s.elements.findIndex((x) => x.id === id)).filter((i) => i >= 0));
    const next = [...s.elements];
    next.splice(firstIdx, 0, ...copies);
    s.setElements(next);
  }

  private movePoints(g: Extract<Gesture, { kind: "point-drag" }>, p0: Point, e: PointerEvent) {
    const s = this.s;
    const o = g.original;
    let p = this.gridPoint(p0, e);
    g.moved = true;
    session.isDragging = true;
    const c = getElementCenter(o);
    const abs = o.points.map(([px, py]) => rotatePoint([o.x + px, o.y + py], c, o.angle));
    const lastIdx = abs.length - 1;
    const single = g.indices.length === 1 ? g.indices[0] : null;
    if (single !== null && e.shiftKey && abs.length > 1) {
      const anchor = abs[single === 0 ? 1 : single - 1];
      p = this.angleSnap(anchor, p);
    }
    const isEnd = single === 0 || single === lastIdx;
    const target = o.type === "arrow" && isEnd ? this.bindableAt(p, o.id, e) : null;
    session.bindTarget = target?.id ?? null;
    if (o.arrowType === "elbow" && isEnd) {
      // re-route the whole elbow arrow
      const startP = single === 0 ? p : abs[0];
      const endP = single === lastIdx ? p : abs[lastIdx];
      const otherBind = single === 0 ? o.endBinding : o.startBinding;
      const other = otherBind ? s.elements.find((x) => x.id === otherBind.elementId) : undefined;
      const tp = target ? getBindingPoint(target, this.makeBinding(o, target, single === 0 ? endP : startP), single === 0 ? endP : startP) : null;
      const op = other ? getBindingPoint(other, otherBind!, single === 0 ? startP : endP) : null;
      const s0 = single === 0 ? tp : op;
      const e0 = single === 0 ? op : tp;
      const route = routeElbow(s0?.point ?? startP, s0?.heading ?? null, e0?.point ?? endP, e0?.heading ?? null);
      s.setElements(s.elements.map((x) => (x.id === o.id ? withAbsolutePoints(o, route) : x)));
      return;
    }
    const d: Point = [p[0] - g.start[0], p[1] - g.start[1]];
    for (const i of g.indices) abs[i] = single !== null ? p : [abs[i][0] + d[0], abs[i][1] + d[1]];
    if (target && single !== null) {
      const ref = abs[single === 0 ? 1 : lastIdx - 1];
      abs[single] = getBindingPoint(target, { elementId: target.id, fixedPoint: null, gap: 6 }, ref).point;
    }
    // closed polygons keep their first and last point together
    if (o.polygon) {
      if (g.indices.includes(0)) abs[lastIdx] = abs[0];
      else if (g.indices.includes(lastIdx)) abs[0] = abs[lastIdx];
    }
    const updated = withAbsolutePoints({ ...o, angle: 0 }, abs);
    s.setElements(updateBoundElements(s.elements.map((x) => (x.id === o.id ? updated : x)), [o.id]));
  }

  private moveCrop(g: Extract<Gesture, { kind: "crop" }>, p: Point, _e: PointerEvent) {
    const s = this.s;
    const o = g.original;
    const files = s.files;
    const file = files[o.fileId];
    if (!file) return;
    const img = new Image();
    img.src = file.dataURL;
    const natW = o.crop?.naturalWidth ?? img.naturalWidth ?? o.width;
    const natH = o.crop?.naturalHeight ?? img.naturalHeight ?? o.height;
    if (!natW || !natH) return;
    const crop = o.crop ?? { x: 0, y: 0, width: natW, height: natH, naturalWidth: natW, naturalHeight: natH };
    const k = o.width / crop.width; // scene px per natural px
    const c = getElementCenter(o);
    const lp = rotatePoint(p, c, -o.angle);
    const ls = rotatePoint(g.start, c, -o.angle);
    const ddx = (lp[0] - ls[0]) / k;
    const ddy = (lp[1] - ls[1]) / k;
    const flipX = o.scale[0] < 0, flipY = o.scale[1] < 0;
    let { x, y, width, height } = crop;
    if (g.handle === "move") {
      x = Math.min(Math.max(0, x - (flipX ? -ddx : ddx)), natW - width);
      y = Math.min(Math.max(0, y - (flipY ? -ddy : ddy)), natH - height);
      this.replace([{ ...o, crop: { ...crop, x, y } } as El]);
      return;
    }
    const h = g.handle;
    const minSize = 10 / k;
    // convert visual edges to natural-image edges, accounting for flips
    const left = h.includes("w"), right = h.includes("e"), top = h.includes("n"), bottom = h.includes("s");
    let ex = 0, ey = 0, ew = 0, eh = 0; // scene-space adjustments of the element box
    if (left !== flipX ? left || right : false) {
      // visual left edge ↔ natural left edge (or right when flipped)
    }
    if (left || right) {
      const visualLeft = left;
      const naturalLeft = visualLeft !== flipX;
      if (naturalLeft) {
        const nx = Math.min(Math.max(0, x + (flipX ? -ddx : ddx)), x + width - minSize);
        const delta = nx - x;
        x = nx;
        width -= delta;
        if (visualLeft) { ex += delta * k; ew -= delta * k; } else ew -= delta * k;
      } else {
        const nw = Math.min(Math.max(minSize, width + (flipX ? -ddx : ddx)), natW - x);
        const delta = nw - width;
        width = nw;
        ew += delta * k;
        if (visualLeft) ex -= delta * k;
      }
    }
    if (top || bottom) {
      const visualTop = top;
      const naturalTop = visualTop !== flipY;
      if (naturalTop) {
        const ny = Math.min(Math.max(0, y + (flipY ? -ddy : ddy)), y + height - minSize);
        const delta = ny - y;
        y = ny;
        height -= delta;
        if (visualTop) { ey += delta * k; eh -= delta * k; } else eh -= delta * k;
      } else {
        const nh = Math.min(Math.max(minSize, height + (flipY ? -ddy : ddy)), natH - y);
        const delta = nh - height;
        height = nh;
        eh += delta * k;
        if (visualTop) ey -= delta * k;
      }
    }
    // reposition taking rotation into account: shift of the box centre in local space
    const newW = o.width + ew, newH = o.height + eh;
    const localCenterShift: Point = [ex + ew / 2, ey + eh / 2];
    const rotatedShift = rotatePoint(localCenterShift, [0, 0], o.angle);
    const cx = c[0] + rotatedShift[0], cy = c[1] + rotatedShift[1];
    this.replace([{ ...o, crop: { x, y, width, height, naturalWidth: natW, naturalHeight: natH }, width: newW, height: newH, x: cx - newW / 2, y: cy - newH / 2 } as El]);
  }

  private eraseAlong(a: Point, b: Point) {
    const s = this.s;
    session.eraserTrail.push({ x: b[0], y: b[1], t: performance.now() });
    const hits = getElementsCrossingSegment(s.elements, a, b, s.appState.zoom);
    for (const el of hits) {
      // erase whole groups and labelled containers together
      let ids = [el.id];
      if (el.type === "text" && (el as TextElement).containerId) ids = [(el as TextElement).containerId!];
      const target = s.elements.find((x) => x.id === ids[0]);
      if (target?.groupIds.length) {
        const gid = getSelectableGroupId(target, s.appState.editingGroupId);
        if (gid) ids = s.elements.filter((x) => x.groupIds.includes(gid) && !x.isDeleted).map((x) => x.id);
      }
      for (const id of ids) session.eraserPending.add(id);
      for (const x of s.elements) if (x.type === "text" && ids.includes((x as TextElement).containerId ?? "")) session.eraserPending.add(x.id);
    }
    requestRepaint();
  }

  // ------------------------------------------------------------------ pointer up
  onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    clearTimeout(this.longPressTimer);
    const s = this.s;
    const g = this.gesture;
    if (g.kind === "pinch") {
      if (this.pointers.size === 0) this.gesture = { kind: "none" };
      else if (this.pointers.size === 1) {
        const [only] = [...this.pointers.values()];
        const as = s.appState;
        this.gesture = { kind: "pan", startX: only[0], startY: only[1], scrollX: as.scrollX, scrollY: as.scrollY };
      }
      return;
    }
    if (this.pointers.size > 0) return;
    this.gesture = { kind: "none" };
    session.isDragging = false;
    session.snapLines = [];
    const p = this.scene(e);

    switch (g.kind) {
      case "pan":
        this.setCursor(this.spaceHeld || s.appState.activeTool === "hand" ? "grab" : "default");
        this.cursor = "";
        break;
      case "laser":
        break;
      case "erase": {
        if (session.eraserPending.size) {
          s.setElements(deleteElementsFrom(s.elements, session.eraserPending));
          session.eraserPending.clear();
        }
        break;
      }
      case "freedraw": {
        const el = s.elements.find((x) => x.id === g.id) as FreeDrawElement | undefined;
        if (el) s.setElements(updateFrameMembership(s.elements, [el.id]));
        break;
      }
      case "create": {
        const el = s.elements.find((x) => x.id === g.id);
        if (!el) break;
        const tiny = el.width * s.appState.zoom < 4 && el.height * s.appState.zoom < 4;
        if (tiny) {
          // a simple click creates a default-sized element (friendlier than nothing on touch)
          const size = el.type === "embeddable" ? [560, 315] : el.type === "frame" ? [400, 300] : [100, 80];
          const as = s.appState;
          if (e.pointerType === "mouse" && el.type !== "embeddable") {
            s.setElements(s.elements.filter((x) => x.id !== el.id));
            break;
          }
          s.setElements(s.elements.map((x) => (x.id === el.id ? ({ ...el, x: el.x - size[0] / 2, y: el.y - size[1] / 2, width: size[0], height: size[1] } as El) : x)));
          void as;
        }
        let next = s.elements;
        if (el.type === "frame") {
          // adopt elements fully inside the new frame
          const f = next.find((x) => x.id === el.id)!;
          next = next.map((x) => {
            if (x.isDeleted || x.id === f.id || x.type === "frame" || x.frameId) return x;
            const b = getElementBounds(x);
            return b[0] >= f.x && b[1] >= f.y && b[2] <= f.x + f.width && b[3] <= f.y + f.height ? ({ ...x, frameId: f.id, version: x.version + 1 } as El) : x;
          });
          // frames sit below their content
          const idx = next.findIndex((x) => x.id === f.id);
          const frameEl = next[idx];
          next = [...next.slice(0, idx), ...next.slice(idx + 1)];
          const firstChild = next.findIndex((x) => x.frameId === f.id);
          next.splice(firstChild >= 0 ? firstChild : next.length, 0, frameEl);
        } else {
          next = updateFrameMembership(next, [el.id]);
        }
        s.setElements(next);
        this.finishTool(el.id);
        if (el.type === "embeddable") s.setAppState({ openDialog: "embed" });
        break;
      }
      case "linear-create": {
        const el = s.elements.find((x) => x.id === g.id) as LinearElement | undefined;
        session.bindTarget = null;
        if (!el) break;
        const len = Math.hypot(el.width, el.height) * s.appState.zoom;
        if (len < 6 && el.arrowType !== "elbow") {
          // click (no drag): continue in click-by-click mode
          const abs: Point[] = [g.origin, p];
          s.setElements(s.elements.map((x) => (x.id === el.id ? withAbsolutePoints(el, abs) : x)));
          session.multiPoint = { id: el.id, cursor: p };
          break;
        }
        if (len < 6) {
          s.setElements(s.elements.filter((x) => x.id !== el.id));
          break;
        }
        let next = s.elements;
        if (el.type === "arrow") {
          const pts = el.points;
          const startAbs: Point = [el.x + pts[0][0], el.y + pts[0][1]];
          const endAbs: Point = [el.x + pts[pts.length - 1][0], el.y + pts[pts.length - 1][1]];
          const endTarget = this.bindableAt(p, el.id, e);
          if (g.startBind && !(endTarget && endTarget.id === g.startBind.id && el.arrowType !== "elbow")) next = this.applyBinding(next, el.id, "start", g.startBind, endAbs);
          if (endTarget && !(g.startBind && endTarget.id === g.startBind.id && el.arrowType !== "elbow")) next = this.applyBinding(next, el.id, "end", endTarget, startAbs);
          next = updateBoundElements(next, [el.id]);
        }
        next = updateFrameMembership(next, [el.id]);
        s.setElements(next);
        this.finishTool(el.id);
        break;
      }
      case "drag": {
        session.frameTarget = null;
        if (!g.moved) {
          // plain click on an element of a multi-selection selects just that element
          if (g.wasSelected && !g.shift) {
            const el = s.elements.find((x) => x.id === g.clickedId);
            if (el && Object.keys(s.appState.selectedElementIds).length > 1) {
              const own = selectionFor(el, s.elements, s.appState);
              if (Object.keys(own).length < Object.keys(s.appState.selectedElementIds).length) s.setAppState({ selectedElementIds: own });
            }
          }
          break;
        }
        let next = s.elements;
        // arrows dragged without their targets come unbound
        for (const id of g.ids) {
          const el = next.find((x) => x.id === id);
          if (!el || !isLinear(el)) continue;
          if (el.startBinding && !g.ids.has(el.startBinding.elementId)) next = this.applyBinding(next, el.id, "start", null, [0, 0]);
          const el2 = next.find((x) => x.id === id) as LinearElement;
          if (el2.endBinding && !g.ids.has(el2.endBinding.elementId)) next = this.applyBinding(next, el.id, "end", null, [0, 0]);
        }
        next = updateFrameMembership(next, g.ids);
        s.setElements(next);
        break;
      }
      case "resize":
      case "rotate": {
        let next = s.elements;
        const ids = g.originals.map((o) => o.id);
        // resized frames re-evaluate which elements they contain
        const frames = g.originals.filter((o) => o.type === "frame");
        if (frames.length) next = updateFrameMembership(next, next.filter((x) => x.type !== "frame").map((x) => x.id));
        else next = updateFrameMembership(next, ids);
        s.setElements(next);
        break;
      }
      case "box": {
        session.boxSelection = null;
        if (Math.hypot(e.clientX - this.downClient[0], e.clientY - this.downClient[1]) < DRAG_THRESHOLD) {
          emit("canvasClick", { point: p, clientX: e.clientX, clientY: e.clientY });
        }
        const sel = s.appState.selectedElementIds;
        s.setAppState({ selectedElementIds: expandToGroups(sel, s.elements, s.appState.editingGroupId) });
        break;
      }
      case "point-drag": {
        const el = s.elements.find((x) => x.id === g.id) as LinearElement | undefined;
        session.bindTarget = null;
        if (!el || !g.moved) break;
        let next = s.elements;
        if (el.type === "arrow" && g.indices.length === 1) {
          const i = g.indices[0];
          const last = el.points.length - 1;
          if (i === 0 || i === last) {
            const end = i === 0 ? "start" : "end";
            const ptAbs: Point = [el.x + el.points[i][0], el.y + el.points[i][1]];
            const target = this.bindableAt(p, el.id, e);
            const otherAbs: Point = [el.x + el.points[i === 0 ? last : 0][0], el.y + el.points[i === 0 ? last : 0][1]];
            next = this.applyBinding(next, el.id, end, target, target ? otherAbs : ptAbs);
            next = updateBoundElements(next, [el.id]);
          }
        }
        s.setElements(next);
        break;
      }
      case "crop":
        break;
    }
    requestRepaint();
  };

  onPointerCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      clearTimeout(this.longPressTimer);
      if (this.gesture.kind !== "none") this.onPointerUp(e);
    }
  };

  onPointerLeave = () => {
    emit("pointerLeave", undefined);
  };

  // ------------------------------------------------------------------ wheel
  onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const s = this.s;
    const as = s.appState;
    if (e.ctrlKey || e.metaKey) {
      // pinch-zoom on trackpads arrives as ctrl+wheel
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0035));
      setZoom(as.zoom * factor, { x: e.clientX, y: e.clientY });
      return;
    }
    let dx = e.deltaX, dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 20; dy *= 20; }
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    s.setAppState({ scrollX: as.scrollX - dx / as.zoom, scrollY: as.scrollY - dy / as.zoom });
  };

  // ------------------------------------------------------------------ keyboard (engine-owned keys)
  /** Returns true when the key was consumed. */
  onKeyDown = (e: KeyboardEvent): boolean => {
    const s = this.s;
    const as = s.appState;
    if (e.key === " " && !e.repeat) {
      this.spaceHeld = true;
      this.setCursor("grab");
      this.cursor = "grab";
      return true;
    }
    if (e.key === "Escape") {
      if (session.multiPoint) { this.finishMultiPoint(); return true; }
      if (as.editingLinearId) { s.setAppState({ editingLinearId: null }); session.linearSelectedPoints = []; return true; }
      if (as.croppingImageId) { s.setAppState({ croppingImageId: null }); return true; }
      if (session.activeEmbedId) { session.activeEmbedId = null; refreshEmbeds(); return true; }
      if (this.gesture.kind !== "none") { this.cancelGesture(); return true; }
      return false;
    }
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      if (session.multiPoint) { this.finishMultiPoint(); return true; }
      if (as.croppingImageId) { s.setAppState({ croppingImageId: null }); return true; }
      const sel = getSelectedElements(s);
      if (sel.length === 1 && !as.viewModeEnabled && !sel[0].locked) {
        const el = sel[0];
        if (el.type === "line" || el.type === "arrow") {
          s.setAppState({ editingLinearId: as.editingLinearId === el.id ? null : el.id });
          session.linearSelectedPoints = [];
        } else if (el.type === "image") this.startCrop(el as ImageElement);
        else if (el.type === "embeddable") { session.activeEmbedId = el.id; refreshEmbeds(); }
        else startTextEditingImpl(el.id);
        return true;
      }
      if (sel.length > 1 && sel[0].groupIds.length) {
        s.setAppState({ editingGroupId: sel[0].groupIds[sel[0].groupIds.length - 1] });
        return true;
      }
      return false;
    }
    if (e.key.startsWith("Arrow") && !e.ctrlKey && !e.metaKey && !as.viewModeEnabled) {
      const sel = getSelectedElements(s).filter((x) => !x.locked);
      if (!sel.length) return false;
      const step = e.shiftKey ? (as.gridModeEnabled ? as.gridSize : 10) : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      if (as.editingLinearId && session.linearSelectedPoints.length) {
        const el = sel[0] as LinearElement;
        s.recordHistory();
        const abs = el.points.map(([px, py], i) => [el.x + px + (session.linearSelectedPoints.includes(i) ? dx : 0), el.y + py + (session.linearSelectedPoints.includes(i) ? dy : 0)] as Point);
        this.replace([withAbsolutePoints(el, abs)]);
        return true;
      }
      if (!e.repeat) s.recordHistory();
      const ids = new Set(sel.map((x) => x.id));
      for (const d of getDependents(ids, s.elements)) ids.add(d);
      this.replace(s.elements.filter((x) => ids.has(x.id)).map((x) => ({ ...x, x: x.x + dx, y: x.y + dy })));
      return true;
    }
    return false;
  };

  onKeyUp = (e: KeyboardEvent) => {
    if (e.key === " ") {
      this.spaceHeld = false;
      const tool = this.s.appState.activeTool;
      this.cursor = "";
      this.setCursor(tool === "hand" ? "grab" : "default");
    }
  };
}

const svgCursor = (svg: string, x: number, y: number, fallback: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;
export const ERASER_CURSOR = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="7" fill="white" stroke="black" stroke-width="1.5"/></svg>`,
  10,
  10,
  "crosshair",
);
export const LASER_CURSOR = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="4" fill="red"/><circle cx="10" cy="10" r="7" fill="none" stroke="rgba(255,0,0,.35)" stroke-width="3"/></svg>`,
  10,
  10,
  "crosshair",
);

/** Resize the element box of a touch device's handle hit radius etc. */
export const isTouchDevice = () => getDevice().isTouch;
export const getElementAbsBox = getElementAbsCoords;
