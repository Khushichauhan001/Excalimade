// Inline, stroke-based 24×24 icons rendered at 20px using currentColor. No icon library.
import type { ReactNode } from "react";
import type { Arrowhead } from "../core/types";

const svg = (children: ReactNode, opts: { fill?: string; strokeWidth?: number } = {}) => (
  <svg
    className="ui-icon"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill={opts.fill ?? "none"}
    stroke="currentColor"
    strokeWidth={opts.strokeWidth ?? 1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

const p = (d: string, extra: Record<string, unknown> = {}) => <path d={d} {...extra} />;

export const Icons = {
  // ---- tools --------------------------------------------------------------
  lockOpen: svg(<>{p("M8 11V7a4 4 0 0 1 7.5-1.9")}<rect x="5" y="11" width="14" height="10" rx="2" /><circle cx="12" cy="16" r="1" /></>),
  lockClosed: svg(<>{p("M8 11V7a4 4 0 0 1 8 0v4")}<rect x="5" y="11" width="14" height="10" rx="2" /><circle cx="12" cy="16" r="1" /></>),
  hand: svg(
    p(
      "M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 5.5v-2a1.5 1.5 0 1 1 3 0V12M14 5.5a1.5 1.5 0 0 1 3 0V12M17 7.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2 .2a6 6 0 0 1-5-2.7L7 19c-.3-.5-1.4-2.4-3.3-5.7a1.5 1.5 0 0 1 .5-2 1.9 1.9 0 0 1 2.3.3L8 13",
    ),
  ),
  selection: svg(<>{p("M6 4l12.5 7-5.6 1.4L10.3 18z")}{p("M13 13l5 5")}</>),
  rectangle: svg(<rect x="4" y="4" width="16" height="16" rx="2.5" />),
  diamond: svg(p("M10.6 3.6a2 2 0 0 1 2.8 0l7 7a2 2 0 0 1 0 2.8l-7 7a2 2 0 0 1-2.8 0l-7-7a2 2 0 0 1 0-2.8z")),
  ellipse: svg(<circle cx="12" cy="12" r="8.5" />),
  arrow: svg(<>{p("M5 19L19 5")}{p("M11 5h8v8")}</>),
  line: svg(p("M5 12h14")),
  freedraw: svg(<>{p("M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16v4")}{p("M13.5 6.5l4 4")}</>),
  text: svg(<>{p("M6 7V5h12v2")}{p("M12 5v14")}{p("M9.5 19h5")}</>),
  image: svg(<><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.6" />{p("M20.5 15.5l-4.5-4.5-10 9")}</>),
  eraser: svg(<>{p("M19 20H8.5l-4.2-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4L11.5 20")}{p("M17.5 13.5L10.5 6.5")}</>),
  frame: svg(<>{p("M4 7.5h16M4 16.5h16M7.5 4v16M16.5 4v16")}</>),
  embed: svg(<><circle cx="12" cy="12" r="9" />{p("M3.6 9h16.8M3.6 15h16.8M11.5 3a17 17 0 0 0 0 18M12.5 3a17 17 0 0 1 0 18")}</>),
  laser: svg(
    <>
      {p("M6 21L18 9l-3-3L3 18z")}
      {p("M14 7l3 3")}
      {p("M9 3a2 2 0 0 0 2 2 2 2 0 0 0-2 2 2 2 0 0 0-2-2 2 2 0 0 0 2-2M19 13a2 2 0 0 0 2 2 2 2 0 0 0-2 2 2 2 0 0 0-2-2 2 2 0 0 0 2-2")}
    </>,
  ),
  moreTools: svg(<><rect x="4" y="4" width="6" height="6" rx="1.2" /><circle cx="17" cy="7" r="3" /><rect x="4" y="14" width="6" height="6" rx="1.2" />{p("M17 14v6M14 17h6")}</>),
  mermaid: svg(<><rect x="3" y="3" width="7" height="5" rx="1.2" /><rect x="14" y="16" width="7" height="5" rx="1.2" />{p("M6.5 8v4.5a2 2 0 0 0 2 2h7a2 2 0 0 1 2 2V16")}</>),
  sparkles: svg(
    p(
      "M16 18a2 2 0 0 1 2 2 2 2 0 0 1 2-2 2 2 0 0 1-2-2 2 2 0 0 1-2 2zm0-12a2 2 0 0 1 2 2 2 2 0 0 1 2-2 2 2 0 0 1-2-2 2 2 0 0 1-2 2zM9 18a6 6 0 0 1 6-6 6 6 0 0 1-6-6 6 6 0 0 1-6 6 6 6 0 0 1 6 6z",
    ),
  ),
  wireframe: svg(<><rect x="3" y="4" width="18" height="16" rx="2" />{p("M3 9h18M9 9v11")}</>),
  chart: svg(p("M4 20h16M7 16v-4M12 16V8M17 16V5")),

  // ---- extended shapes ----------------------------------------------------
  triangle: svg(p("M12 4.5l8.5 14.5h-17z")),
  star: svg(p("M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.9z")),
  hexagon: svg(p("M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z")),
  cylinder: svg(<><ellipse cx="12" cy="6" rx="7" ry="2.5" />{p("M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6")}</>),
  cloud: svg(p("M7 18.5a4.5 4.3 0 0 1-.4-8.6A5.5 5 0 0 1 17.2 9 4 4 0 0 1 17.5 18.5z")),
  callout: svg(p("M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-8l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5z")),

  // ---- chrome -------------------------------------------------------------
  menu: svg(p("M4 6h16M4 12h16M4 18h16")),
  users: svg(<><circle cx="9" cy="7" r="4" />{p("M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 3.1a4 4 0 0 1 0 7.8M21 21v-2a4 4 0 0 0-3-3.9")}</>),
  library: svg(<>{p("M5 4h4v16H5zM9 4h4v16H9z")}{p("M13.6 4.6l3.9-1 4 15.5-3.9 1z")}</>),
  undo: svg(p("M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11")),
  redo: svg(p("M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13")),
  plus: svg(p("M12 5v14M5 12h14")),
  minus: svg(p("M5 12h14")),
  help: svg(<><circle cx="12" cy="12" r="9" />{p("M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01")}</>),
  close: svg(p("M18 6L6 18M6 6l12 12")),
  search: svg(<><circle cx="11" cy="11" r="7" />{p("M20 20l-4-4")}</>),
  check: svg(p("M5 12l5 5L20 7")),
  trash: svg(p("M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3")),
  duplicate: svg(<><rect x="8" y="8" width="12" height="12" rx="2" />{p("M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2")}</>),
  group: svg(<>{p("M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3")}<rect x="7.5" y="7.5" width="5" height="5" rx="1" /><rect x="11.5" y="11.5" width="5" height="5" rx="1" /></>),
  ungroup: svg(<><rect x="4" y="4" width="7" height="7" rx="1.2" /><rect x="13" y="13" width="7" height="7" rx="1.2" />{p("M14 6h4v4M6 14v4h4", { strokeDasharray: "2 2" })}</>),
  link: svg(p("M10 14a3.5 3.5 0 0 0 5 0l4-4a3.5 3.5 0 0 0-5-5l-.5.5M14 10a3.5 3.5 0 0 0-5 0l-4 4a3.5 3.5 0 0 0 5 5l.5-.5")),
  bringToFront: svg(<>{p("M4 4h16")}{p("M12 20V8M8 12l4-4 4 4")}</>),
  bringForward: svg(<>{p("M12 19V5M8 9l4-4 4 4")}{p("M5 19h3M16 19h3")}</>),
  sendBackward: svg(<>{p("M12 5v14M8 15l4 4 4-4")}{p("M5 5h3M16 5h3")}</>),
  sendToBack: svg(<>{p("M4 20h16")}{p("M12 4v12M8 12l4 4 4-4")}</>),
  alignLeft: svg(<>{p("M4 4v16")}<rect x="8" y="6" width="11" height="4.5" rx="1" /><rect x="8" y="13.5" width="7" height="4.5" rx="1" /></>),
  alignCenterH: svg(<>{p("M12 4v16")}<rect x="6.5" y="6" width="11" height="4.5" rx="1" /><rect x="8.5" y="13.5" width="7" height="4.5" rx="1" /></>),
  alignRight: svg(<>{p("M20 4v16")}<rect x="5" y="6" width="11" height="4.5" rx="1" /><rect x="9" y="13.5" width="7" height="4.5" rx="1" /></>),
  alignTop: svg(<>{p("M4 4h16")}<rect x="6" y="8" width="4.5" height="11" rx="1" /><rect x="13.5" y="8" width="4.5" height="7" rx="1" /></>),
  alignCenterV: svg(<>{p("M4 12h16")}<rect x="6" y="6.5" width="4.5" height="11" rx="1" /><rect x="13.5" y="8.5" width="4.5" height="7" rx="1" /></>),
  alignBottom: svg(<>{p("M4 20h16")}<rect x="6" y="5" width="4.5" height="11" rx="1" /><rect x="13.5" y="9" width="4.5" height="7" rx="1" /></>),
  distributeH: svg(<>{p("M4 4v16M20 4v16")}<rect x="9.5" y="7" width="5" height="10" rx="1" /></>),
  distributeV: svg(<>{p("M4 4h16M4 20h16")}<rect x="7" y="9.5" width="10" height="5" rx="1" /></>),
  flipH: svg(<>{p("M12 3v18", { strokeDasharray: "2 2.5" })}{p("M16 7l4 10h-4zM8 7L4 17h4z")}</>),
  flipV: svg(<>{p("M3 12h18", { strokeDasharray: "2 2.5" })}{p("M7 8l10-4v4zM7 16l10 4v-4z")}</>),
  eyedropper: svg(<>{p("M11 7l6 6")}{p("M4 16L15.7 4.3a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4L8 20H4z")}</>),
  sun: svg(<><circle cx="12" cy="12" r="4" />{p("M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4")}</>),
  moon: svg(p("M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z")),
  folder: svg(p("M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2")),
  save: svg(p("M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5 5-5M12 4v12")),
  exportImage: svg(<>{p("M12 20H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v5")}{p("M4 15l4-4c.9-.9 2.1-.9 3 0l4 4")}{p("M15 8h.01")}{p("M16 19h6M19 16l3 3-3 3")}</>),
  pdf: svg(<>{p("M14 3v4a1 1 0 0 0 1 1h4")}{p("M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z")}{p("M9 13h6M9 17h4")}</>),
  present: svg(<>{p("M3 4h18M4 4v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4M12 16v4M9 20h6")}{p("M10 8l4 2-4 2z")}</>),
  command: svg(p("M7 9a2 2 0 1 1 2-2v10a2 2 0 1 1-2-2h10a2 2 0 1 1-2 2V7a2 2 0 1 1 2 2H7")),
  logIn: svg(p("M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3")),
  keyboard: svg(<><rect x="2.5" y="6" width="19" height="12" rx="2" />{p("M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7 14h10")}</>),
  externalLink: svg(p("M12 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6M11 13l9-9M15 4h5v5")),
  chevronDown: svg(p("M6 9l6 6 6-6")),
  chevronRight: svg(p("M9 6l6 6-6 6")),
  chevronUp: svg(p("M6 15l6-6 6 6")),
  grid: svg(<><rect x="4" y="4" width="16" height="16" rx="1.5" />{p("M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16")}</>),
  magnet: svg(p("M5 4h4v8a3 3 0 0 0 6 0V4h4v8a7 7 0 0 1-14 0zM5 8h4M15 8h4")),
  zen: svg(p("M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4")),
  eye: svg(<>{p("M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z")}<circle cx="12" cy="12" r="3" /></>),
  stats: svg(<>{p("M4 19h16")}<rect x="5.5" y="11" width="3" height="5" rx=".5" /><rect x="10.5" y="7" width="3" height="9" rx=".5" /><rect x="15.5" y="4" width="3" height="12" rx=".5" /></>),
  copy: svg(<><rect x="8" y="8" width="12" height="12" rx="2" />{p("M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2")}</>),
  cut: svg(<><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" />{p("M8.2 15L19 4M15.8 15L5 4")}</>),
  paste: svg(<>{p("M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2")}<rect x="9" y="3" width="6" height="4" rx="1" /></>),
  palette: svg(<>{p("M12 21a9 9 0 0 1 0-18c5 0 9 3.6 9 8 0 1-.5 2-1.3 2.8-.8.8-2 1.2-3.2 1.2H14a2 2 0 0 0-1 3.8A1.3 1.3 0 0 1 12 21")}<circle cx="7.5" cy="10.5" r=".8" /><circle cx="12" cy="7.5" r=".8" /><circle cx="16.5" cy="10.5" r=".8" /></>),
  selectAll: svg(<>{p("M4 4h16v16H4z", { strokeDasharray: "2.5 2.5" })}<rect x="8.5" y="8.5" width="7" height="7" rx="1" /></>),
  convert: svg(p("M4 8h12M13 5l3 3-3 3M20 16H8M11 13l-3 3 3 3")),
  edit: svg(<>{p("M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16v4")}{p("M13.5 6.5l4 4")}</>),
  dots: svg(p("M5 12h.01M12 12h.01M19 12h.01"), { strokeWidth: 3 }),
  info: svg(<><circle cx="12" cy="12" r="9" />{p("M12 8h.01M11 12h1v4h1")}</>),
  github: svg(p("M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21")),
  swap: svg(p("M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7")),

  // ---- properties ---------------------------------------------------------
  fillHachure: svg(<><rect x="4" y="4" width="16" height="16" rx="2" />{p("M4.5 11.5l7-7M4.5 17.5l13-13M8 19.5l11.5-11.5M14 19.5l5.5-5.5")}</>),
  fillCrossHatch: svg(<><rect x="4" y="4" width="16" height="16" rx="2" />{p("M4.5 11.5l7-7M4.5 17.5l13-13M8 19.5l11.5-11.5M14 19.5l5.5-5.5M12.5 4.5l7 7M6.5 4.5l13 13M4.5 8l11.5 11.5M4.5 14l5.5 5.5")}</>),
  fillSolid: svg(<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" />),
  fillZigzag: svg(<><rect x="4" y="4" width="16" height="16" rx="2" />{p("M6 15l3-6 3 6 3-6 3 6")}</>),
  fillDots: svg(<><rect x="4" y="4" width="16" height="16" rx="2" />{p("M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01", { strokeWidth: 2.4 })}</>),
  strokeThin: svg(p("M4 12h16", { strokeWidth: 1.25 })),
  strokeBold: svg(p("M4 12h16", { strokeWidth: 2.5 })),
  strokeExtraBold: svg(p("M4 12h16", { strokeWidth: 4.25 })),
  strokeSolid: svg(p("M4 12h16", { strokeWidth: 2 })),
  strokeDashed: svg(p("M4 12h16", { strokeWidth: 2, strokeDasharray: "4.5 3.5", strokeLinecap: "butt" })),
  strokeDotted: svg(p("M4.5 12h15", { strokeWidth: 2.2, strokeDasharray: "0.01 4.4" })),
  sloppyArchitect: svg(p("M3.5 16c3-7.5 14-7.5 17 0", { strokeWidth: 2 })),
  sloppyArtist: svg(p("M3.5 16c2.5-5 4.5-8.5 7.5-7.5s2 4.5 4.5 3.5 3-3.5 5-2", { strokeWidth: 2 })),
  sloppyCartoonist: svg(p("M3 14c1.5-3 2.5-6.5 4-5s0 6.5 2 6.5 2-8 4-8 1 7.5 3 7.5 2.5-5 5-5", { strokeWidth: 2 })),
  edgeSharp: svg(p("M5 19V5h14", { strokeWidth: 2 })),
  edgeRound: svg(p("M5 19v-8a6 6 0 0 1 6-6h8", { strokeWidth: 2 })),
  arrowSharp: svg(<>{p("M5 19L19 5")}{p("M12 5h7v7")}</>),
  arrowCurved: svg(<>{p("M4 19C5 11 10 6 18 5")}{p("M14.5 2.5L18.5 5l-2.5 4")}</>),
  arrowElbow: svg(<>{p("M4 19h7V6h8")}{p("M16 3l3 3-3 3")}</>),
  textLeft: svg(p("M4 6h16M4 12h10M4 18h13")),
  textCenter: svg(p("M4 6h16M7 12h10M5.5 18h13")),
  textRight: svg(p("M4 6h16M10 12h10M7 18h13")),
  vAlignTop: svg(<><rect x="4" y="4" width="16" height="16" rx="2" />{p("M8 8h8M9 11h6")}</>),
  vAlignMiddle: svg(<><rect x="4" y="4" width="16" height="16" rx="2" />{p("M8 10.5h8M9 13.5h6")}</>),
  vAlignBottom: svg(<><rect x="4" y="4" width="16" height="16" rx="2" />{p("M8 13h8M9 16h6")}</>),
  transparent: svg(<><rect x="4" y="4" width="16" height="16" rx="2" />{p("M5 19L19 5")}</>),
} as const;

export type IconName = keyof typeof Icons;

/** Small preview of an arrowhead: a short line with the head drawn at the right end (or left for start). */
export function ArrowheadIcon({ head, start = false }: { head: Arrowhead; start?: boolean }) {
  const t = start ? "translate(24 0) scale(-1 1)" : undefined;
  const sw = 1.75;
  let headEl: ReactNode = null;
  let lineEnd = 20;
  switch (head) {
    case "arrow":
      headEl = <path d="M14 7l6 5-6 5" />;
      break;
    case "bar":
      headEl = <path d="M20 6v12" />;
      break;
    case "dot":
      headEl = <circle cx="18" cy="12" r="2.5" fill="currentColor" />;
      lineEnd = 16;
      break;
    case "circle":
      headEl = <circle cx="17" cy="12" r="3.2" fill="currentColor" />;
      lineEnd = 14;
      break;
    case "circle_outline":
      headEl = <circle cx="17" cy="12" r="3.2" />;
      lineEnd = 13.8;
      break;
    case "triangle":
      headEl = <path d="M14 7.5l6.5 4.5-6.5 4.5z" fill="currentColor" />;
      lineEnd = 14;
      break;
    case "triangle_outline":
      headEl = <path d="M14 7.5l6.5 4.5-6.5 4.5z" />;
      lineEnd = 14;
      break;
    case "diamond":
      headEl = <path d="M11 12l4.5-4 4.5 4-4.5 4z" fill="currentColor" />;
      lineEnd = 11;
      break;
    case "diamond_outline":
      headEl = <path d="M11 12l4.5-4 4.5 4-4.5 4z" />;
      lineEnd = 11;
      break;
    case "crowfoot_one":
      headEl = <path d="M16 6.5v11" />;
      break;
    case "crowfoot_many":
      headEl = <path d="M14 12l6-5.5M14 12l6 5.5" />;
      break;
    case "crowfoot_one_or_many":
      headEl = <path d="M14 12l6-5.5M14 12l6 5.5M12 6.5v11" />;
      break;
    default:
      break;
  }
  return (
    <svg className="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g transform={t}>
        <path d={`M3 12H${lineEnd}`} />
        {headEl}
      </g>
    </svg>
  );
}

/** Excalimade logo mark: a sketchy pen stroke inside a rounded square. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" rx="10" fill="var(--color-primary)" />
      <path d="M11 27.5c3-1 5.5-4.5 8-8.5s5.5-7.5 9-8" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M12.5 30.5c4-.6 9.5-.8 15.5 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".75" />
      <path d="M25.5 10.5l3.5-1.2-.6 3.6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
