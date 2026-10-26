// Shared data model. Every module builds on these types — change with care.

export type Point = [number, number];

export type ToolType =
  | "selection"
  | "hand"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "triangle"
  | "star"
  | "hexagon"
  | "cylinder"
  | "cloud"
  | "callout"
  | "arrow"
  | "line"
  | "freedraw"
  | "text"
  | "image"
  | "eraser"
  | "laser"
  | "frame"
  | "embeddable";

/** Closed shapes that can contain text and be converted into one another. */
export type ShapeType =
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "triangle"
  | "star"
  | "hexagon"
  | "cylinder"
  | "cloud"
  | "callout";

export const SHAPE_TYPES: ShapeType[] = [
  "rectangle",
  "diamond",
  "ellipse",
  "triangle",
  "star",
  "hexagon",
  "cylinder",
  "cloud",
  "callout",
];

export type FillStyle = "hachure" | "cross-hatch" | "solid" | "zigzag" | "dots";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type Roundness = "sharp" | "round";
export type TextAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";
export type Arrowhead =
  | null
  | "arrow"
  | "bar"
  | "dot"
  | "circle"
  | "circle_outline"
  | "triangle"
  | "triangle_outline"
  | "diamond"
  | "diamond_outline"
  | "crowfoot_one"
  | "crowfoot_many"
  | "crowfoot_one_or_many";
export type ArrowType = "sharp" | "round" | "elbow";

/** Font family ids. 1-3 are the built-in trio; the rest come from the extended picker. */
export type FontFamily = number;

export interface Binding {
  elementId: string;
  /** Normalised [0..1] anchor within the bound element's box; null = auto (closest edge). */
  fixedPoint: Point | null;
  gap: number;
}

export interface BaseElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number; // radians, rotation around the element centre
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number; // 1 thin, 2 bold, 4 extra bold
  strokeStyle: StrokeStyle;
  roughness: number; // 0 architect, 1 artist, 2 cartoonist
  roundness: Roundness;
  opacity: number; // 0-100
  seed: number; // rough.js seed so the sketch is stable between renders
  version: number; // incremented on every change (used by collab reconciliation)
  versionNonce: number;
  updated: number; // epoch ms
  isDeleted: boolean;
  locked: boolean;
  groupIds: string[]; // innermost group first
  frameId: string | null;
  link: string | null; // URL or "#element=<id>" for in-canvas links
  boundElements: { id: string; type: "arrow" | "text" }[];
  customData?: Record<string, unknown>;
}

export interface ShapeElement extends BaseElement {
  type: ShapeType;
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  originalText: string;
  fontSize: number;
  fontFamily: FontFamily;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  lineHeight: number; // multiplier
  /** Id of the shape or arrow this text is a label of. */
  containerId: string | null;
  autoResize: boolean;
}

export interface LinearElement extends BaseElement {
  type: "arrow" | "line";
  /** Points relative to (x, y). The first point is always [0, 0]. */
  points: Point[];
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  arrowType: ArrowType;
  startBinding: Binding | null;
  endBinding: Binding | null;
  /** Lines only: closed polygon when the last point meets the first. */
  polygon: boolean;
}

export interface FreeDrawElement extends BaseElement {
  type: "freedraw";
  points: Point[];
  pressures: number[];
  simulatePressure: boolean;
}

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

export interface ImageElement extends BaseElement {
  type: "image";
  fileId: string;
  scale: [number, number]; // [-1|1, -1|1] for flips
  crop: ImageCrop | null;
}

export interface FrameElement extends BaseElement {
  type: "frame";
  name: string | null;
}

export interface EmbeddableElement extends BaseElement {
  type: "embeddable";
  // the URL lives in `link`
}

export type ExcalidrawElement =
  | ShapeElement
  | TextElement
  | LinearElement
  | FreeDrawElement
  | ImageElement
  | FrameElement
  | EmbeddableElement;

export interface BinaryFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created: number;
}
export type BinaryFiles = Record<string, BinaryFile>;

export interface Collaborator {
  id: string;
  username: string;
  color: string;
  pointer?: { x: number; y: number; tool: "pointer" | "laser" };
  selectedElementIds?: string[];
  viewport?: { scrollX: number; scrollY: number; zoom: number; width: number; height: number };
  isSpeaking?: boolean;
  isMuted?: boolean;
}

export type Theme = "light" | "dark";

export type DialogName =
  | null
  | "help"
  | "export-image"
  | "export-json"
  | "library"
  | "mermaid"
  | "text-to-diagram"
  | "wireframe-to-code"
  | "chart"
  | "collab"
  | "share"
  | "cloud"
  | "history"
  | "embed"
  | "link"
  | "fonts"
  | "command-palette"
  | "find"
  | "clear-canvas"
  | "slides";

export interface AppState {
  // viewport
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number; // canvas size in CSS px
  height: number;

  // tools
  activeTool: ToolType;
  toolLocked: boolean;
  lastActiveTool: ToolType; // restored after temporary hand-tool (space) etc.
  penMode: boolean;

  // current item style (applied to new elements and shown in the properties panel)
  currentItemStrokeColor: string;
  currentItemBackgroundColor: string;
  currentItemFillStyle: FillStyle;
  currentItemStrokeWidth: number;
  currentItemStrokeStyle: StrokeStyle;
  currentItemRoughness: number;
  currentItemRoundness: Roundness;
  currentItemOpacity: number;
  currentItemFontFamily: FontFamily;
  currentItemFontSize: number;
  currentItemTextAlign: TextAlign;
  currentItemStartArrowhead: Arrowhead;
  currentItemEndArrowhead: Arrowhead;
  currentItemArrowType: ArrowType;

  // selection & editing
  selectedElementIds: Record<string, true>;
  /** Group the user has "entered" via double-click; selection then works inside it. */
  editingGroupId: string | null;
  editingTextId: string | null;
  /** Linear element whose points are being edited (double-click on a line/arrow). */
  editingLinearId: string | null;
  croppingImageId: string | null;
  editingFrameNameId: string | null;

  // view
  theme: Theme;
  viewBackgroundColor: string;
  gridModeEnabled: boolean;
  gridSize: number;
  objectsSnapModeEnabled: boolean;
  zenModeEnabled: boolean;
  viewModeEnabled: boolean;
  statsOpen: boolean;
  presentationMode: { frameIndex: number } | null;
  /** Presentation settings saved with the scene: custom frame order and frames skipped as slides. */
  slides: { order: string[]; hidden: string[] };

  // ui
  openDialog: DialogName;
  openSidebar: null | "library" | "comments" | "search" | "versions";
  openMenu: null | "main" | "shape" | "help";
  contextMenu: { x: number; y: number } | null;
  toast: { message: string; kind?: "info" | "error" | "success" } | null;
  name: string; // scene title

  // collaboration
  collaborators: Record<string, Collaborator>;
  followingUserId: string | null;
  username: string;
}

export interface Scene {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

export interface LibraryItem {
  id: string;
  name: string;
  status: "published" | "unpublished";
  created: number;
  elements: ExcalidrawElement[];
}
