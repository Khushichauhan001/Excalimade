import { useEffect, useRef } from "react";
import { getState, useStore } from "../core/store";
import { isInputTarget } from "../core/utils";
import { on } from "../core/events";
import { renderStaticScene } from "../render/scene";
import { onImageLoaded } from "../render/images";
import { PointerController } from "./pointer";
import { renderInteractive } from "./interactive";
import { session, setRepaintHandler } from "./session";
import { EmbedsLayer } from "./embeds";
import { TextEditor, FrameNameEditor } from "./TextEditor";
import { handlePasteData, copyToClipboard, pasteElements } from "./clipboard";
import { startTextEditingImpl } from "./commands";
import { insertImages } from "./images";
import { viewportToScene } from "../core/utils";

export function Canvas() {
  const staticRef = useRef<HTMLCanvasElement>(null);
  const interRef = useRef<HTMLCanvasElement>(null);
  const ctrl = useRef(new PointerController());

  useEffect(() => {
    const sc = staticRef.current!, ic = interRef.current!;
    const c = ctrl.current;
    c.setCursor = (cur) => (ic.style.cursor = cur);
    let frame = 0;
    const paint = () => {
      frame = 0;
      const s = getState();
      renderStaticScene(sc, s.elements, s.appState, { files: s.files, fadedIds: session.eraserPending, hiddenIds: session.hiddenIds });
      if (renderInteractive(ic, s.elements, s.appState, s.files)) schedule();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    setRepaintHandler(schedule);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth, h = window.innerHeight;
      for (const cv of [sc, ic]) {
        cv.width = Math.floor(w * dpr);
        cv.height = Math.floor(h * dpr);
        cv.style.width = w + "px";
        cv.style.height = h + "px";
      }
      getState().setAppState({ width: w, height: h });
      schedule();
    };
    resize();

    const unsub = useStore.subscribe(schedule);
    const unImg = onImageLoaded(schedule);
    const onKey = (e: KeyboardEvent) => {
      if (isInputTarget(e.target) || getState().appState.editingTextId) return;
      if (c.onKeyDown(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => c.onKeyUp(e);
    const onCopy = (e: ClipboardEvent) => {
      if (isInputTarget(e.target) || !Object.keys(getState().appState.selectedElementIds).length) return;
      e.preventDefault();
      void copyToClipboard(e.type === "cut");
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isInputTarget(e.target)) return;
      e.preventDefault();
      const d = e.clipboardData;
      void handlePasteData({ text: d?.getData("text/plain") ?? "", html: d?.getData("text/html") ?? "", files: [...(d?.files ?? [])] });
    };
    const onDrop = (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      void insertImages(files, { x: e.clientX, y: e.clientY });
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const wheel = (e: WheelEvent) => c.onWheel(e);

    ic.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    document.addEventListener("paste", onPaste);
    ic.addEventListener("drop", onDrop);
    ic.addEventListener("dragover", onDragOver);
    const offs = [
      on("editText", ({ elementId }) => startTextEditingImpl(elementId)),
      on("insertAtPoint", ({ elements, clientX, clientY }) => {
        session.lastPointer = viewportToScene(clientX, clientY, getState().appState);
        pasteElements(elements);
      }),
    ];
    return () => {
      unsub();
      unImg();
      offs.forEach((f) => f());
      ic.removeEventListener("wheel", wheel);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("paste", onPaste);
      ic.removeEventListener("drop", onDrop);
      ic.removeEventListener("dragover", onDragOver);
    };
  }, []);

  const theme = useStore((s) => s.appState.theme);
  const c = ctrl.current;
  const full = { position: "fixed", inset: 0, touchAction: "none" } as const;
  return (
    <>
      <canvas ref={staticRef} style={{ ...full, zIndex: 1, filter: theme === "dark" ? "invert(93%) hue-rotate(180deg)" : undefined }} />
      <canvas
        ref={interRef}
        style={{ ...full, zIndex: 2 }}
        onPointerDown={(e) => c.onPointerDown(e.nativeEvent)}
        onPointerMove={(e) => c.onPointerMove(e.nativeEvent)}
        onPointerUp={(e) => c.onPointerUp(e.nativeEvent)}
        onPointerCancel={(e) => c.onPointerCancel(e.nativeEvent)}
        onPointerLeave={() => c.onPointerLeave()}
        onContextMenu={(e) => c.onContextMenu(e.nativeEvent)}
      />
      <EmbedsLayer />
      <TextEditor />
      <FrameNameEditor />
    </>
  );
}
