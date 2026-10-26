import { useState } from "react";
import { getState, useStore } from "../core/store";
import { getAction } from "../core/actions";
import { scrollToElements } from "../core/viewport";
import { Dialog } from "../ui/components/Dialog";
import { Button } from "../ui/components/Button";
import { getSlideFrames } from "./frames";
import { startPresentation } from "./presentation";
import type { FrameElement } from "../core/types";

const close = () => getState().setAppState({ openDialog: null });

/** Slide list: reorder frames by drag-and-drop and choose which ones are presented. */
export function SlidesPanel() {
  const elements = useStore((s) => s.elements);
  const slides = useStore((s) => s.appState.slides);
  const frames = getSlideFrames(elements.filter((e) => !e.isDeleted), slides.order);
  const hidden = new Set(slides.hidden);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const save = (order: string[], hiddenIds: string[]) => getState().setAppState({ slides: { order, hidden: hiddenIds } });
  const move = (id: string, beforeId: string | null) => {
    const ids = frames.map((f) => f.id).filter((x) => x !== id);
    const i = beforeId ? ids.indexOf(beforeId) : ids.length;
    ids.splice(i < 0 ? ids.length : i, 0, id);
    save(ids, slides.hidden);
  };
  const toggle = (f: FrameElement) =>
    save(frames.map((x) => x.id), hidden.has(f.id) ? slides.hidden.filter((x) => x !== f.id) : [...slides.hidden, f.id]);
  const shown = frames.filter((f) => !hidden.has(f.id));
  const pdf = getAction("io.exportPdf");

  return (
    <Dialog
      title="Slides"
      size="small"
      onClose={close}
      footer={
        <>
          {pdf && shown.length > 0 && <Button onClick={() => (close(), pdf.perform(getState(), "ui"))}>Export PDF</Button>}
          <Button variant="primary" disabled={!shown.length} onClick={() => (close(), void startPresentation(0))}>
            Present
          </Button>
        </>
      }
    >
      {!frames.length ? (
        <p className="io-slides__empty">Every frame is a slide. Draw a frame with the frame tool (F), put content inside, then come back here to present.</p>
      ) : (
        <>
          <p className="io-slides__hint">Drag to reorder. Untick a slide to skip it. The order is saved with this scene.</p>
          <ol className="io-slides" onDragEnd={() => (setDragId(null), setOverId(null))}>
            {frames.map((f, i) => (
              <li
                key={f.id}
                className={`io-slide ${hidden.has(f.id) ? "is-skipped" : ""} ${overId === f.id ? "is-over" : ""} ${dragId === f.id ? "is-dragging" : ""}`}
                draggable
                onDragStart={(e) => (e.dataTransfer.setData("text/plain", f.id), setDragId(f.id))}
                onDragOver={(e) => (e.preventDefault(), setOverId(f.id))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== f.id) {
                    // dropping on a later slide places after it, on an earlier one before it
                    const from = frames.findIndex((x) => x.id === dragId);
                    move(dragId, from < i ? frames[i + 1]?.id ?? null : f.id);
                  }
                  setDragId(null);
                  setOverId(null);
                }}
              >
                <span className="io-slide__grip" aria-hidden="true">⋮⋮</span>
                <span className="io-slide__num">{hidden.has(f.id) ? "–" : shown.indexOf(f) + 1}</span>
                <button className="io-slide__name" title="Show on canvas" onClick={() => (close(), scrollToElements([f], true))}>
                  {f.name ?? `Frame ${i + 1}`}
                </button>
                <label className="io-slide__toggle" title={hidden.has(f.id) ? "Skipped" : "Included"}>
                  <input type="checkbox" checked={!hidden.has(f.id)} onChange={() => toggle(f)} aria-label={`Include ${f.name ?? `frame ${i + 1}`}`} />
                </label>
                <span className="io-slide__moves">
                  <button aria-label="Move up" disabled={i === 0} onClick={() => move(f.id, frames[i - 1].id)}>↑</button>
                  <button aria-label="Move down" disabled={i === frames.length - 1} onClick={() => move(f.id, frames[i + 2]?.id ?? null)}>↓</button>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Dialog>
  );
}
