# Excalimade — architecture & team contract

A from-scratch, feature-complete clone of excalidraw.com (plus Excalidraw+ features), built with
**React 19 + TypeScript + Vite**, **roughjs** (hand-drawn rendering), **perfect-freehand** (pencil),
**zustand** (state), **@dagrejs/dagre** (diagram layout), and a small **Node** server (`server/`, `ws` for WebSockets,
built-in `node:sqlite` for storage). Run: `npm run dev` (vite on :5173 proxies `/api` and `/ws` to the server on :3001).

## Hard constraints
- **Small footprint.** Do not add npm dependencies. Use platform APIs (Web Crypto, CompressionStream, IndexedDB,
  WebRTC, fetch). Gzip anything persisted. Downscale images. Lazy-load heavy UI with `import()`.
- **No placeholders.** Every button must work. No "coming soon", no lorem ipsum, no mock data.
- **Responsive.** Must work on phones (< 730px), tablets and desktop, with touch and mouse. Use `useDevice()`
  from `src/core/useDevice.ts`. Dialogs become full-screen sheets on phones. Hit targets ≥ 36px on touch.
- **Polished UI** in the Excalidraw style: white "islands" with soft shadow (`var(--island-shadow)`), 8–12px radius,
  primary violet `var(--color-primary)`, Nunito UI font, light + dark theme via CSS variables in `src/index.css`
  (`.theme--dark` class is set on `<html>`). Always style with those tokens so dark mode works. Inline SVG icons
  (stroke-based, 20px, `currentColor`), no icon libraries.
- TypeScript strict. `npx tsc -b` must pass for your files (ignore errors in other agents' folders while they work).
  Server code: `npx tsc -p tsconfig.server.json`.

## Ownership (each module owns its folder; do not edit other folders — ask the lead instead)
| Module | Owner | Files |
|---|---|---|
| Core contracts | lead | `src/core/*` (types, store, elements, geometry, text, actions, events, viewport, utils, binding) |
| Canvas engine | lead | `src/canvas/*`, `src/render/*` — rendering, all tool interactions, hit-testing, selection/transform, binding, text editing, image insert/crop, frames, embeds, laser, eraser, snapping, clipboard of elements |
| UI shell | ui agent | `src/ui/*` |
| Import/export, library, PWA, presentation | io agent | `src/io/*`, `src/library/*`, `server/libraries.ts`, `public/manifest.webmanifest`, `public/sw.js`, `public/icons/*` |
| Diagrams & AI | diagram agent | `src/diagram/*`, `server/ai.ts` |
| Real-time collaboration & share links | collab agent | `src/collab/*`, `server/collab.ts` |
| Cloud (accounts, workspaces, scenes, comments, versions, permissions) | cloud agent | `src/cloud/*`, `server/cloud.ts`, `server/db.ts` |

Each module mounts ONE root component in `src/App.tsx`: `UILayer`, `IOLayer`, `CollabLayer` (named exports),
`DiagramLayer`, `CloudLayer` (default exports, lazy loaded). A layer renders its own dialogs/sidebars/overlays,
usually keyed on `appState.openDialog` / `appState.openSidebar`. Each layer imports its own CSS file
(class-name prefix per module: `ui-`, `io-`, `dg-`, `cb-`, `cl-`).

### z-index scale
canvas 1–3 · collab overlay (cursors) 4 · embeds overlay 5 · UI chrome 10 · sidebars 20 · dialogs 50 · popovers/menus 60 · toasts 70

## Key contracts (read the source — they are short)
- `src/core/types.ts` — element model (Excalidraw-compatible JSON), `AppState`, `ToolType`, `DialogName`.
- `src/core/store.ts` — `useStore` (zustand). `elements` is the z-ordered array incl. soft-deleted ones.
  Mutate via `setElements`, `mutateElements(patches)` (bumps `version`), `setAppState`. **Call `recordHistory()`
  BEFORE a user-visible change** so undo works. Helpers: `getNonDeletedElements`, `getSelectedElements`, `showToast`.
- `src/core/elements.ts` — factories (`newShape`, `newText`, `newLinear`, `newFreeDraw`, `newImage`, `newFrame`,
  `newEmbeddable`), `duplicateElements`, `insertElements(els, {select, centerInView})` (records history),
  `bindTextToContainer`, `bindArrow`.
- `src/core/binding.ts` — after moving/resizing/converting elements call
  `setElements(updateBoundElements(elements, changedIds))` so arrows and labels follow.
  After changing text/font of a label call `refreshTextLayout`.
- `src/core/geometry.ts` — bounds helpers (`getElementBounds`, `getCommonBounds`, …).
- `src/core/viewport.ts` — `setZoom`, `zoomIn/Out`, `resetZoom`, `zoomToFit`, `scrollToElements`, `animateViewport`.
  Canvas fills the window, so client coords == viewport coords. `viewportToScene` / `sceneToViewport` in utils.
- `src/core/actions.ts` — action registry. Register every command with `registerActions([...])` at module load,
  with `shortcuts` where applicable; the UI agent's keyboard handler, command palette and context menu consume it.
- `src/core/events.ts` — event bus (`on`, `emit`): `pointer`, `pointerLeave`, `sceneLoaded`, `insertAtPoint`,
  `editText`, `canvasClick`; and `registerPasteHandler` (return true to consume a paste).
- `src/core/text.ts` — `FONTS` (ids match Excalidraw: 5 Excalifont, 6 Nunito, 8 Comic Shanns, 1 Virgil,
  2 Helvetica, 3 Cascadia, …), `measureText`, `wrapText`, `getFontString`.
- `src/render/export.ts` — `exportToCanvas(elements, opts)`, `exportToSvg(elements, opts)`.
- `src/canvas/api.ts` — `insertImageFiles`, `copySelection`, `cutSelection`, `pasteFromClipboard`,
  `deleteSelection`, `startTextEditing`, `followLink`.

## Element & tool notes
- Shapes: rectangle, diamond, ellipse + extended: triangle, star, hexagon, cylinder, cloud, callout (`SHAPE_TYPES`).
  "Shape conversion" = change `type` among `SHAPE_TYPES` keeping text/bindings/styles, then `updateBoundElements`.
- Linear: `points` relative to `(x,y)`, first point `[0,0]`. `arrowType`: sharp | round (curved) | elbow.
- Embeddable: URL in `link`; generated HTML (wireframe-to-code) in `customData.html` (rendered as `srcdoc`).
- Frames: children have `frameId`. Frame `name` shown above it. Presentation mode uses frames ordered by x, then y.
- `appState.presentationMode != null` → UI chrome hides; io agent renders the presenter controls.
- `appState.viewModeEnabled` → read-only; `zenModeEnabled` → hide everything but the toolbar/canvas.

## Server
`server/index.ts` routes `/api/*` to handlers `(req, res, url) => boolean` (return true when handled) and upgrades
`/ws` to `handleCollabSocket`. Helpers in `server/http.ts` (`readJson`, `sendJson`). Persist under `server/data/`
(gitignored). To test your server module alone: `PORT=31xx npx tsx server/index.ts` on your assigned port.
