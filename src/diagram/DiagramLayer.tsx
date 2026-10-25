import { useEffect, useMemo, useRef, useState } from "react";
import "./diagram.css";
import { getState, getSelectedElements, useStore } from "../core/store";
import { insertElements, newEmbeddable } from "../core/elements";
import type { ExcalidrawElement, FrameElement, TextElement } from "../core/types";
import { exportToCanvas, exportToSvg } from "../render/export";
import { Dialog } from "../ui/components/Dialog";
import { Button } from "../ui/components/Button";
import { mermaidToElements, MERMAID_EXAMPLES, MermaidError } from "./mermaid";
import { parseTable } from "./chart/table";
import { buildChart, type ChartType } from "./chart/build";
import { session } from "./session";

const close = () => getState().setAppState({ openDialog: null });

/** Live SVG preview of elements. */
function Preview({ elements, error }: { elements: ExcalidrawElement[] | null; error?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.innerHTML = "";
    if (!elements?.length) return;
    let alive = true;
    exportToSvg(elements, { files: getState().files, exportBackground: false, viewBackgroundColor: "#fff", exportDarkMode: false, scale: 1, padding: 16 }).then((svg) => {
      if (!alive) return;
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      node.appendChild(svg);
    });
    return () => void (alive = false);
  }, [elements]);
  return (
    <div className="dg-preview">
      <div ref={ref} className="dg-preview__svg" />
      {error && <div className="dg-error">{error}</div>}
      {!error && !elements?.length && <div className="dg-empty">Preview appears here</div>}
    </div>
  );
}

function convert(src: string): { elements: ExcalidrawElement[] | null; error: string | null } {
  if (!src.trim()) return { elements: null, error: null };
  try {
    return { elements: mermaidToElements(src).elements, error: null };
  } catch (e) {
    const err = e as MermaidError & { line?: number };
    return { elements: null, error: (err.line ? `Line ${err.line}: ` : "") + (err.message ?? String(e)) };
  }
}

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ------------------------------------------------------------- Mermaid
function MermaidDialog() {
  const [src, setSrc] = useState(session.mermaidDraft ?? MERMAID_EXAMPLES[0].code);
  const debounced = useDebounced(src);
  const result = useMemo(() => convert(debounced), [debounced]);
  const insert = () => {
    if (!result.elements) return;
    insertElements(result.elements);
    session.mermaidDraft = null;
    close();
  };
  return (
    <Dialog title="Mermaid to Excalidraw" onClose={close} size="wide" footer={<Button variant="primary" disabled={!result.elements} onClick={insert}>Insert</Button>}>
      <div className="dg-split">
        <div className="dg-col">
          <div className="dg-examples">
            {MERMAID_EXAMPLES.map((ex) => (
              <button key={ex.id} className="dg-chip" onClick={() => setSrc(ex.code)}>{ex.label}</button>
            ))}
          </div>
          <textarea className="dg-code" spellCheck={false} value={src} onChange={(e) => setSrc(e.target.value)} onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && insert()} />
          <p className="dg-hint">Supports flowchart, sequence, class, ER, state and pie diagrams. Ctrl/⌘+Enter inserts.</p>
        </div>
        <Preview elements={result.elements} error={result.error} />
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------- Text to diagram (AI)
async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const remaining = res.headers.get("X-RateLimit-Remaining");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { setup: data.setup });
  return { data, remaining: remaining ? Number(remaining) : null };
}

function TextToDiagram() {
  const [prompt, setPrompt] = useState("");
  const [mermaid, setMermaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ msg: string; setup?: string } | null>(null);
  const [remaining, setRemaining] = useState<number | null>(session.aiUsage["text-to-diagram"]?.remaining ?? null);
  const result = useMemo(() => convert(mermaid), [mermaid]);

  const generate = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      let { data, remaining: r } = await postJson("/api/ai/text-to-diagram", { prompt });
      // one automatic retry when the result doesn't parse
      const check = convert(data.mermaid);
      if (check.error) ({ data, remaining: r } = await postJson("/api/ai/text-to-diagram", { prompt, previousError: check.error, previousMermaid: data.mermaid }));
      setMermaid(data.mermaid);
      session.aiHistory.unshift({ id: Date.now(), prompt, mermaid: data.mermaid });
      if (r !== null) setRemaining(r);
    } catch (e) {
      setError({ msg: (e as Error).message, setup: (e as { setup?: string }).setup });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Text to diagram"
      onClose={close}
      size="wide"
      footer={
        <>
          {mermaid && <Button onClick={() => ((session.mermaidDraft = mermaid), getState().setAppState({ openDialog: "mermaid" }))}>Edit as Mermaid</Button>}
          <Button variant="primary" disabled={!result.elements} onClick={() => (insertElements(result.elements!), close())}>Insert</Button>
        </>
      }
    >
      <div className="dg-split">
        <div className="dg-col">
          <textarea
            className="dg-prompt"
            autoFocus
            placeholder="Describe a diagram, e.g. “User signup flow with email verification and a retry loop”"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), generate())}
          />
          <Button variant="primary" disabled={busy || !prompt.trim()} onClick={generate}>{busy ? "Generating…" : "Generate"}</Button>
          {remaining !== null && <p className="dg-hint">{remaining} generations left today</p>}
          {error && (
            <div className="dg-error">
              {error.msg}
              {error.setup && <div className="dg-setup">{error.setup}</div>}
            </div>
          )}
          {session.aiHistory.length > 0 && (
            <div className="dg-history">
              {session.aiHistory.slice(0, 6).map((h) => (
                <button key={h.id} className="dg-chip" onClick={() => (setPrompt(h.prompt), h.mermaid && setMermaid(h.mermaid))}>{h.prompt.slice(0, 40)}</button>
              ))}
            </div>
          )}
        </div>
        <Preview elements={result.elements} error={mermaid ? result.error : null} />
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------- Wireframe to code (AI)
function WireframeToCode() {
  const frame = useStore((s) => {
    const sel = getSelectedElements(s);
    return sel.length === 1 && sel[0].type === "frame" ? (sel[0] as FrameElement) : null;
  });
  const [html, setHtml] = useState(frame ? session.wireframeResults.get(frame.id) ?? "" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ msg: string; setup?: string } | null>(null);

  if (!frame) {
    return (
      <Dialog title="Wireframe to code" onClose={close} size="small" footer={<Button variant="primary" onClick={() => getState().setAppState({ openDialog: null, activeTool: "frame" })}>Create a frame</Button>}>
        <ol className="dg-steps">
          <li>Draw a frame with the frame tool (F).</li>
          <li>Sketch your UI inside it: boxes, buttons, text.</li>
          <li>Select the frame and run “Wireframe to code”.</li>
        </ol>
      </Dialog>
    );
  }

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = getState();
      const children = s.elements.filter((e) => !e.isDeleted && e.frameId === frame.id);
      const canvas = await exportToCanvas(children, { files: s.files, exportBackground: true, viewBackgroundColor: "#ffffff", exportDarkMode: false, scale: Math.min(2, 1600 / Math.max(frame.width, frame.height)), frameId: frame.id });
      const texts = children.filter((e) => e.type === "text").map((e) => (e as TextElement).originalText);
      const { data } = await postJson("/api/ai/wireframe-to-code", { image: canvas.toDataURL("image/png"), texts, theme: s.appState.theme });
      setHtml(data.html);
      session.wireframeResults.set(frame.id, data.html);
    } catch (e) {
      setError({ msg: (e as Error).message, setup: (e as { setup?: string }).setup });
    } finally {
      setBusy(false);
    }
  };

  const insert = () => {
    const el = newEmbeddable({ link: "about:srcdoc", customData: { html }, x: frame.x + frame.width + 40, y: frame.y, width: frame.width, height: frame.height } as never);
    insertElements([el], { select: true, centerInView: false });
    close();
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `${frame.name ?? "wireframe"}.html`;
    a.click();
  };

  return (
    <Dialog
      title="Wireframe to code"
      onClose={close}
      size="wide"
      footer={
        html ? (
          <>
            <Button onClick={() => navigator.clipboard.writeText(html)}>Copy HTML</Button>
            <Button onClick={download}>Download .html</Button>
            <Button onClick={generate} disabled={busy}>{busy ? "Generating…" : "Regenerate"}</Button>
            <Button variant="primary" onClick={insert}>Insert next to frame</Button>
          </>
        ) : (
          <Button variant="primary" onClick={generate} disabled={busy}>{busy ? "Generating… (can take a minute)" : "Generate code"}</Button>
        )
      }
    >
      {error && (
        <div className="dg-error">
          {error.msg}
          {error.setup && <div className="dg-setup">{error.setup}</div>}
        </div>
      )}
      {html ? <iframe className="dg-result" title="Generated page" sandbox="allow-scripts" srcDoc={html} /> : <p className="dg-hint">Turns the sketch in “{frame.name ?? "Frame"}” into a working HTML page.</p>}
    </Dialog>
  );
}

// ------------------------------------------------------------- Chart
function ChartDialog() {
  const [raw, setRaw] = useState(session.chart?.raw ?? "Month,Sales,Costs\nJan,120,80\nFeb,150,95\nMar,180,110\nApr,140,90");
  const [type, setType] = useState<ChartType>("bar");
  const [title, setTitle] = useState("");
  const data = useMemo(() => parseTable(raw), [raw]);
  const elements = useMemo(() => {
    try {
      return data ? buildChart(data, { type, title: title || undefined }) : null;
    } catch {
      return null;
    }
  }, [data, type, title]);
  return (
    <Dialog title="Chart from data" onClose={close} size="wide" footer={<Button variant="primary" disabled={!elements} onClick={() => (insertElements(elements!), (session.chart = null), close())}>Insert chart</Button>}>
      <div className="dg-split">
        <div className="dg-col">
          <div className="dg-examples">
            {(["bar", "line"] as const).map((t) => (
              <button key={t} className={`dg-chip ${type === t ? "is-active" : ""}`} onClick={() => setType(t)}>{t === "bar" ? "Bar chart" : "Line chart"}</button>
            ))}
          </div>
          <input className="ui-search-input" placeholder="Chart title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="dg-code" spellCheck={false} value={raw} onChange={(e) => setRaw(e.target.value)} />
          <p className="dg-hint">Paste CSV or spreadsheet cells: first column = labels, other columns = numbers. Tip: paste a table straight onto the canvas.</p>
        </div>
        <Preview elements={elements} error={data ? null : "Need at least 2 rows with a numeric column"} />
      </div>
    </Dialog>
  );
}

export default function DiagramLayer() {
  const d = useStore((s) => s.appState.openDialog);
  if (d === "mermaid") return <MermaidDialog />;
  if (d === "text-to-diagram") return <TextToDiagram />;
  if (d === "wireframe-to-code") return <WireframeToCode />;
  if (d === "chart") return <ChartDialog />;
  return null;
}
