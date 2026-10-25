import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore, showToast } from "../core/store";
import { exportToCanvas } from "../render/export";
import { IoDialog } from "./Dialog";
import {
  copyPng,
  copySvg,
  defaultExportSettings,
  exportOptions,
  getExportTarget,
  savePng,
  saveSvg,
  type ImageExportSettings,
} from "./exportImage";
import { CopyIcon, DownloadIcon } from "./icons";

const SCALES = [1, 2, 3];

export function ExportImageDialog({ onClose }: { onClose: () => void }) {
  const hasSelection = useStore((s) => Object.keys(s.appState.selectedElementIds).length > 0);
  const sceneNonce = useStore((s) => s.sceneNonce);
  const bgColor = useStore((s) => s.appState.viewBackgroundColor);
  const [settings, setSettings] = useState<ImageExportSettings>(defaultExportSettings);
  const [name, setName] = useState(() => useStore.getState().appState.name || "Untitled");
  const [preview, setPreview] = useState<{ canvas: HTMLCanvasElement; w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof ImageExportSettings>(k: K, v: ImageExportSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const effective: ImageExportSettings = { ...settings, onlySelected: settings.onlySelected && hasSelection };

  // live preview (debounced), rendered at device resolution; the size label reports the real output
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { elements, frameId } = getExportTarget(effective.onlySelected);
        if (!elements.length) {
          setPreview(null);
          setError("Nothing to export");
          return;
        }
        const ps = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        const canvas = await exportToCanvas(elements, exportOptions({ ...effective, scale: ps }, frameId));
        if (cancelled) return;
        canvas.style.width = `${canvas.width / ps}px`;
        setError(null);
        setPreview({ canvas, w: Math.round((canvas.width / ps) * effective.scale), h: Math.round((canvas.height / ps) * effective.scale) });
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        setPreview(null);
        setError("Preview unavailable");
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effective.background, effective.darkMode, effective.onlySelected, effective.padding, effective.scale, sceneNonce, bgColor]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    if (preview) {
      preview.canvas.className = "io-export__canvas";
      host.appendChild(preview.canvas);
    }
  }, [preview]);

  const run = async (id: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(id);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      showToast(e instanceof Error && e.message ? `Export failed: ${e.message}` : "Export failed", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <IoDialog title="Export image" size="wide" onClose={onClose} className="io-export">
      <div className="io-export__layout">
        <div className={`io-export__preview ${settings.background ? "" : "io-checker"}`}>
          <div ref={hostRef} className="io-export__canvas-host" />
          {error && <div className="io-export__empty">{error}</div>}
          {preview && (
            <div className="io-export__size" title="Output size in pixels">
              {preview.w} × {preview.h} px
            </div>
          )}
        </div>
        <div className="io-export__settings">
          <label className="io-field">
            <span className="io-field__label">File name</span>
            <input className="io-input" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
          </label>
          <Toggle label="Background" checked={settings.background} onChange={(v) => set("background", v)} />
          <Toggle label="Dark mode" checked={settings.darkMode} onChange={(v) => set("darkMode", v)} />
          <Toggle
            label="Embed scene"
            hint="Saves the drawing inside the PNG/SVG so it can be opened and edited again. Increases file size."
            checked={settings.embedScene}
            onChange={(v) => set("embedScene", v)}
          />
          {hasSelection && <Toggle label="Only selected" checked={settings.onlySelected} onChange={(v) => set("onlySelected", v)} />}
          <div className="io-row">
            <span className="io-field__label">Scale</span>
            <div className="io-segmented" role="radiogroup" aria-label="Scale">
              {SCALES.map((sc) => (
                <button
                  key={sc}
                  role="radio"
                  aria-checked={settings.scale === sc}
                  className={settings.scale === sc ? "is-active" : ""}
                  onClick={() => set("scale", sc)}
                >
                  {sc}×
                </button>
              ))}
            </div>
          </div>
          <label className="io-row">
            <span className="io-field__label">Padding</span>
            <span className="io-range">
              <input type="range" min={0} max={80} step={2} value={settings.padding} onChange={(e) => set("padding", Number(e.target.value))} />
              <span className="io-range__value">{settings.padding}px</span>
            </span>
          </label>
          <div className="io-export__actions">
            <ActionButton primary busy={busy === "png"} onClick={() => run("png", () => savePng(effective, name))} icon={<DownloadIcon />}>
              PNG
            </ActionButton>
            <ActionButton primary busy={busy === "svg"} onClick={() => run("svg", () => saveSvg(effective, name))} icon={<DownloadIcon />}>
              SVG
            </ActionButton>
            <ActionButton busy={busy === "copy"} onClick={() => run("copy", () => copyPng(effective))} icon={<CopyIcon />}>
              Copy PNG
            </ActionButton>
            <ActionButton busy={busy === "copysvg"} onClick={() => run("copysvg", () => copySvg(effective))} icon={<CopyIcon />}>
              Copy SVG
            </ActionButton>
          </div>
        </div>
      </div>
    </IoDialog>
  );
}

function Toggle(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="io-row io-toggle" title={props.hint}>
      <span className="io-field__label">
        {props.label}
        {props.hint && <span className="io-field__hint">{props.hint}</span>}
      </span>
      <input type="checkbox" className="io-switch" role="switch" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
    </label>
  );
}

function ActionButton(props: { primary?: boolean; busy?: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button className={`io-btn ${props.primary ? "io-btn--primary" : ""}`} onClick={props.onClick} disabled={props.busy} aria-busy={props.busy}>
      {props.busy ? <span className="io-spinner" /> : props.icon}
      {props.children}
    </button>
  );
}
