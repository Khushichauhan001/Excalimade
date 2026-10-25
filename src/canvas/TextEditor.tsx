import { useEffect, useLayoutEffect, useRef } from "react";
import { getState, useStore } from "../core/store";
import type { TextElement } from "../core/types";
import { getFontCss } from "../core/text";
import { refreshTextLayout } from "../core/binding";
import { getElementCenter } from "../core/geometry";
import { getContainerTextBox } from "../render/shapes";
import { randomInteger } from "../core/utils";
import { deleteElementsFrom } from "./commands";
import { session, requestRepaint } from "./session";

/** Inline textarea positioned exactly over the text element being edited. */
export function TextEditor() {
  const editingId = useStore((s) => s.appState.editingTextId);
  const el = useStore((s) => (editingId ? (s.elements.find((e) => e.id === editingId) as TextElement | undefined) : undefined));
  const container = useStore((s) => (el?.containerId ? s.elements.find((e) => e.id === el.containerId) : undefined));
  const as = useStore((s) => s.appState);
  const ref = useRef<HTMLTextAreaElement>(null);
  const committed = useRef(false);

  useEffect(() => {
    if (!editingId) return;
    committed.current = false;
    session.hiddenIds.add(editingId);
    requestRepaint();
    const ta = ref.current;
    if (ta) {
      ta.value = (getState().elements.find((e) => e.id === editingId) as TextElement | undefined)?.originalText ?? "";
      requestAnimationFrame(() => {
        ta.focus();
        ta.select();
      });
    }
    return () => {
      session.hiddenIds.delete(editingId);
      requestRepaint();
    };
  }, [editingId]);

  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta || !el) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, el.fontSize * el.lineHeight * as.zoom)}px`;
  });

  if (!editingId || !el) return null;

  const update = (value: string) => {
    const s = getState();
    const next = s.elements.map((e) =>
      e.id === el.id ? ({ ...e, text: value, originalText: value, version: e.version + 1, versionNonce: randomInteger(), updated: Date.now() } as TextElement) : e,
    );
    s.setElements(refreshTextLayout(next, el.id));
  };

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const s = getState();
    const cur = s.elements.find((e) => e.id === el.id) as TextElement | undefined;
    const value = ref.current?.value ?? "";
    if (cur && !value.trim()) {
      s.setElements(deleteElementsFrom(s.elements, new Set([cur.id])));
      s.setAppState({ editingTextId: null, selectedElementIds: cur.containerId ? { [cur.containerId]: true } : {} });
      return;
    }
    s.setAppState({ editingTextId: null, selectedElementIds: { [cur?.containerId ?? el.id]: true } });
  };

  const z = as.zoom;
  const center = getElementCenter(el);
  const cx = (center[0] + as.scrollX) * z;
  const cy = (center[1] + as.scrollY) * z;
  const lineH = el.fontSize * el.lineHeight;
  let width = el.width;
  if (container && container.type !== "arrow" && container.type !== "line") width = getContainerTextBox(container.type, container.width, container.height).w;
  else if (!el.containerId) width = Math.max(el.width, el.fontSize * 0.6) + el.fontSize * 0.8; // room for the next char
  else width = Math.max(el.width, 40);
  const height = Math.max(el.height, lineH);
  const dark = as.theme === "dark";

  return (
    <textarea
      ref={ref}
      className="text-editor"
      dir="auto"
      wrap={el.containerId || !el.autoResize ? "soft" : "off"}
      spellCheck
      onChange={(e) => update(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          commit();
        } else if (e.key === "Tab") {
          e.preventDefault();
          const ta = e.currentTarget;
          const { selectionStart: a, selectionEnd: b } = ta;
          ta.setRangeText("    ", a, b, "end");
          update(ta.value);
        }
      }}
      style={{
        position: "fixed",
        left: cx - (width * z) / 2,
        top: cy - (height * z) / 2,
        width: width * z,
        minHeight: lineH * z,
        transform: `rotate(${el.angle}rad)`,
        transformOrigin: "center",
        font: `${el.fontSize * z}px ${getFontCss(el.fontFamily)}`,
        lineHeight: el.lineHeight,
        textAlign: el.textAlign,
        // the canvas is colour-inverted in dark mode; mirror that for the editor text
        color: el.strokeColor,
        filter: dark ? "invert(93%) hue-rotate(180deg)" : undefined,
        opacity: el.opacity / 100,
        background: "transparent",
        border: 0,
        outline: 0,
        padding: 0,
        margin: 0,
        resize: "none",
        overflow: "hidden",
        whiteSpace: el.containerId || !el.autoResize ? "pre-wrap" : "pre",
        wordBreak: el.containerId ? "break-word" : "normal",
        zIndex: 6,
        caretColor: el.strokeColor,
      }}
    />
  );
}

/** Inline input for renaming a frame (double-click on its name). */
export function FrameNameEditor() {
  const id = useStore((s) => s.appState.editingFrameNameId);
  const frame = useStore((s) => (id ? s.elements.find((e) => e.id === id) : undefined));
  const as = useStore((s) => s.appState);
  if (!id || !frame || frame.type !== "frame") return null;
  const commit = (value: string) => {
    const s = getState();
    s.recordHistory();
    s.mutateElements({ [id]: { name: value.trim() || null } as any });
    s.setAppState({ editingFrameNameId: null });
  };
  return (
    <input
      autoFocus
      defaultValue={(frame as any).name ?? ""}
      placeholder="Frame name"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit(e.currentTarget.value);
        if (e.key === "Escape") getState().setAppState({ editingFrameNameId: null });
      }}
      style={{
        position: "fixed",
        left: (frame.x + as.scrollX) * as.zoom,
        top: (frame.y + as.scrollY) * as.zoom - 26,
        width: Math.max(140, Math.min(frame.width * as.zoom, 320)),
        font: "500 14px var(--ui-font)",
        padding: "2px 6px",
        borderRadius: 6,
        border: "1px solid var(--color-primary)",
        background: "var(--island-bg)",
        color: "var(--text)",
        zIndex: 6,
        outline: "none",
      }}
    />
  );
}
