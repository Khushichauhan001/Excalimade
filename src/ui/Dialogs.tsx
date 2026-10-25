import { useEffect, useMemo, useRef, useState } from "react";
import { getState, useStore, getSelectedElements } from "../core/store";
import { getActions, type Action } from "../core/actions";
import { newEmbeddable } from "../core/elements";
import { scrollToElements } from "../core/viewport";
import type { FrameElement, TextElement } from "../core/types";
import { toEmbedUrl } from "../canvas/embeds";
import { Dialog } from "./components/Dialog";
import { Button } from "./components/Button";
import { MenuItem, MenuSeparator } from "./components/Menu";
import { fuzzyScore } from "./lib/fuzzy";
import { prettyShortcut } from "./lib/shortcuts";
import { useActionsVersion } from "./lib/hooks";

const close = () => getState().setAppState({ openDialog: null });
const run = (a: Action, src: "palette" | "contextMenu") => {
  getState().setAppState({ openDialog: null, contextMenu: null });
  a.perform(getState(), src);
};
const available = (a: Action) => !a.predicate || a.predicate(getState());

// ------------------------------------------------------------- command palette
function CommandPalette() {
  useActionsVersion();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const list = useMemo(() => {
    const acts = getActions().filter((a) => a.palette !== false && available(a));
    if (!q) return acts.sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
    return acts
      .map((a) => ({ a, s: Math.max(fuzzyScore(q, a.label), ...(a.keywords ?? []).map((k) => fuzzyScore(q, k) - 5), fuzzyScore(q, a.category) - 10) }))
      .filter((x) => x.s >= 0)
      .sort((x, y) => y.s - x.s)
      .map((x) => x.a);
  }, [q]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => listRef.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" }), [idx]);
  return (
    <Dialog title="Command palette" onClose={close} size="regular">
      <input
        autoFocus
        className="ui-search-input"
        placeholder="Search commands…"
        value={q}
        onChange={(e) => (setQ(e.target.value), setIdx(0))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setIdx((i) => Math.min(i + 1, list.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setIdx((i) => Math.max(i - 1, 0)));
          if (e.key === "Enter" && list[idx]) run(list[idx], "palette");
        }}
      />
      <div className="ui-cmd-list" ref={listRef}>
        {list.map((a, i) => (
          <button key={a.id} className={`ui-menu-item ${i === idx ? "is-active" : ""}`} onMouseEnter={() => setIdx(i)} onClick={() => run(a, "palette")}>
            <span className="ui-menu-item__label">{a.label}</span>
            <span className="ui-cmd-cat">{a.category}</span>
            {a.shortcuts?.[0] && <span className="ui-menu-item__shortcut">{prettyShortcut(a.shortcuts[0])}</span>}
          </button>
        ))}
        {!list.length && <div className="ui-empty">No matching commands</div>}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------- help
const HELP_GROUPS: [string, [string, string][]][] = [
  ["Tools", [["Selection", "V / 1"], ["Rectangle", "R / 2"], ["Diamond", "D / 3"], ["Ellipse", "O / 4"], ["Arrow", "A / 5"], ["Line", "L / 6"], ["Draw", "P / 7"], ["Text", "T / 8"], ["Image", "9"], ["Eraser", "E / 0"], ["Hand (pan)", "H or hold Space"], ["Frame", "F"], ["Laser pointer", "K"], ["Keep tool active", "Q"]]],
  ["Editor", [["Finish line / exit editing", "Esc / Enter"], ["Edit text or label", "Enter / double-click"], ["Edit line points", "Enter on a line"], ["Crop image", "Enter / double-click"], ["Move by 1px / 10px", "Arrows / Shift+Arrows"], ["Constrain proportions / angles", "Shift"], ["Resize from centre", "Alt"], ["Duplicate while dragging", "Alt+drag"], ["Toggle snapping while dragging", "Ctrl/⌘"], ["Close a polygon", "Click the first point"]]],
  ["View", [["Zoom", "Ctrl/⌘ + wheel or pinch"], ["Pan", "Wheel / Space+drag / two fingers"]]],
];
function HelpDialog() {
  useActionsVersion();
  const [q, setQ] = useState("");
  const actionRows = getActions().filter((a) => a.shortcuts?.length).map((a) => [a.label, a.shortcuts!.map(prettyShortcut).join(" / ")] as [string, string]);
  const groups: [string, [string, string][]][] = [...HELP_GROUPS, ["Commands", actionRows]];
  const match = (r: [string, string]) => !q || r[0].toLowerCase().includes(q.toLowerCase());
  return (
    <Dialog title="Help & keyboard shortcuts" onClose={close} size="wide">
      <input className="ui-search-input" placeholder="Search shortcuts…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="ui-help-grid">
        {groups.map(([title, rows]) => {
          const r = rows.filter(match);
          return r.length ? (
            <section key={title}>
              <h3>{title}</h3>
              {r.map(([label, keys]) => (
                <div className="ui-help-row" key={label + keys}>
                  <span>{label}</span>
                  <kbd>{keys}</kbd>
                </div>
              ))}
            </section>
          ) : null;
        })}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------- find on canvas
function FindPanel() {
  const elements = useStore((s) => s.elements);
  const [q, setQ] = useState("");
  const [cur, setCur] = useState(0);
  const results = useMemo(() => {
    if (!q.trim()) return [];
    const needle = q.toLowerCase();
    return elements.filter((e) => {
      if (e.isDeleted) return false;
      if (e.type === "text") return (e as TextElement).originalText.toLowerCase().includes(needle);
      if (e.type === "frame") return ((e as FrameElement).name ?? "frame").toLowerCase().includes(needle);
      return false;
    });
  }, [q, elements]);
  const go = (i: number) => {
    if (!results.length) return;
    const n = (i + results.length) % results.length;
    setCur(n);
    const el = results[n];
    const target = el.type === "text" && (el as TextElement).containerId ? elements.find((e) => e.id === (el as TextElement).containerId) ?? el : el;
    getState().setAppState({ selectedElementIds: { [target.id]: true } });
    scrollToElements([target]);
  };
  return (
    <div className="ui-find ui-island" onPointerDown={(e) => e.stopPropagation()}>
      <input
        autoFocus
        className="ui-search-input"
        placeholder="Find text on canvas…"
        value={q}
        onChange={(e) => (setQ(e.target.value), setCur(0))}
        onKeyDown={(e) => {
          if (e.key === "Enter") go(e.shiftKey ? cur - 1 : results.length && q ? cur + (results[cur] && getState().appState.selectedElementIds[results[cur].id] ? 1 : 0) : 0);
          if (e.key === "Escape") close();
        }}
      />
      <div className="ui-find__bar">
        <span>{q ? (results.length ? `${cur + 1} / ${results.length}` : "No results") : "Type to search"}</span>
        <button className="ui-icon-btn" aria-label="Previous" onClick={() => go(cur - 1)}>↑</button>
        <button className="ui-icon-btn" aria-label="Next" onClick={() => go(cur + 1)}>↓</button>
        <button className="ui-icon-btn" aria-label="Close" onClick={close}>✕</button>
      </div>
      <div className="ui-find__list">
        {results.slice(0, 50).map((el, i) => (
          <button key={el.id} className={`ui-menu-item ${i === cur ? "is-active" : ""}`} onClick={() => go(i)}>
            {el.type === "frame" ? `▢ ${(el as FrameElement).name ?? "Frame"}` : (el as TextElement).originalText.slice(0, 80)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- clear canvas
function ClearCanvas() {
  return (
    <Dialog
      title="Reset the canvas"
      onClose={close}
      size="small"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              const s = getState();
              s.recordHistory();
              s.setElements(s.elements.map((e) => (e.isDeleted ? e : { ...e, isDeleted: true, version: e.version + 1 })));
              s.setAppState({ selectedElementIds: {}, openDialog: null });
            }}
          >
            Reset canvas
          </Button>
        </>
      }
    >
      <p>This clears the whole canvas. You can undo it with Ctrl/⌘+Z.</p>
    </Dialog>
  );
}

// ------------------------------------------------------------- link editor
function LinkDialog() {
  const sel = getSelectedElements();
  const [value, setValue] = useState(sel[0]?.link ?? "");
  const save = (link: string | null) => {
    const s = getState();
    s.recordHistory();
    const patch: Record<string, { link: string | null }> = {};
    for (const e of getSelectedElements(s)) patch[e.id] = { link };
    s.mutateElements(patch);
    close();
  };
  if (!sel.length) return null;
  return (
    <Dialog
      title="Link"
      onClose={close}
      size="small"
      footer={
        <>
          {sel[0].link && <Button variant="danger" onClick={() => save(null)}>Remove link</Button>}
          <Button variant="primary" onClick={() => save(value.trim() || null)}>Save</Button>
        </>
      }
    >
      <input autoFocus className="ui-search-input" placeholder="https://… or #element=<id>" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save(value.trim() || null)} />
      <p className="ui-hint">Link to another element on this canvas: right-click it → “Copy link to element”, or paste <code>#element=&lt;id&gt;</code>.</p>
    </Dialog>
  );
}

// ------------------------------------------------------------- embed
function EmbedDialog() {
  const [url, setUrl] = useState("");
  const info = toEmbedUrl(url);
  const cancel = () => {
    // drop an empty embed frame created by the tool
    const s = getState();
    s.setElements(s.elements.filter((e) => !(e.type === "embeddable" && !e.link && !e.customData?.html)));
    close();
  };
  const save = () => {
    if (!info) return;
    const s = getState();
    const target = getSelectedElements(s).find((e) => e.type === "embeddable");
    if (target) s.mutateElements({ [target.id]: { link: url.trim() } });
    else {
      const as = s.appState;
      const el = newEmbeddable({ link: url.trim(), width: info.width, height: info.height, x: as.width / 2 / as.zoom - as.scrollX - info.width / 2, y: as.height / 2 / as.zoom - as.scrollY - info.height / 2 });
      s.recordHistory();
      s.setElements([...s.elements, el]);
      s.setAppState({ selectedElementIds: { [el.id]: true } });
    }
    close();
  };
  return (
    <Dialog title="Embed a website" onClose={cancel} size="small" footer={<Button variant="primary" disabled={!info} onClick={save}>Embed</Button>}>
      <input autoFocus className="ui-search-input" placeholder="Paste a YouTube, Figma, Vimeo, CodePen, Loom, Spotify… link" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      <p className="ui-hint">{info ? (info.kind === "generic" ? "Any https page — some sites block embedding." : `Detected: ${info.kind}`) : "Enter a valid https:// link."}</p>
    </Dialog>
  );
}

// ------------------------------------------------------------- context menu
function ContextMenu() {
  useActionsVersion();
  const cm = useStore((s) => s.appState.contextMenu);
  const hasSel = useStore((s) => Object.keys(s.appState.selectedElementIds).length > 0);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!cm || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(cm.x, window.innerWidth - r.width - 8), y: Math.max(8, Math.min(cm.y, window.innerHeight - r.height - 8)) });
  }, [cm]);
  useEffect(() => {
    if (!cm) return;
    const off = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && getState().setAppState({ contextMenu: null });
    const esc = (e: KeyboardEvent) => e.key === "Escape" && getState().setAppState({ contextMenu: null });
    window.addEventListener("pointerdown", off, true);
    window.addEventListener("keydown", esc, true);
    return () => (window.removeEventListener("pointerdown", off, true), window.removeEventListener("keydown", esc, true));
  }, [cm]);
  if (!cm) return null;
  const kind = hasSel ? "element" : "canvas";
  const acts = getActions().filter((a) => (a.contextMenu === kind || a.contextMenu === "both") && available(a));
  const cats = [...new Set(acts.map((a) => a.category))];
  return (
    <div ref={ref} className="ui-menu ui-context-menu" role="menu" style={{ left: pos?.x ?? cm.x, top: pos?.y ?? cm.y, visibility: pos ? "visible" : "hidden" }} onContextMenu={(e) => e.preventDefault()}>
      {cats.map((c, i) => (
        <div key={c}>
          {i > 0 && <MenuSeparator />}
          {acts.filter((a) => a.category === c).map((a) => (
            <MenuItem key={a.id} label={a.label} shortcut={a.shortcuts?.[0]} danger={a.id === "edit.delete"} onSelect={() => run(a, "contextMenu")} />
          ))}
        </div>
      ))}
      {!acts.length && <div className="ui-empty">Nothing to do here</div>}
    </div>
  );
}

export function Dialogs() {
  const d = useStore((s) => s.appState.openDialog);
  return (
    <>
      {d === "command-palette" && <CommandPalette />}
      {d === "help" && <HelpDialog />}
      {d === "find" && <FindPanel />}
      {d === "clear-canvas" && <ClearCanvas />}
      {d === "link" && <LinkDialog />}
      {d === "embed" && <EmbedDialog />}
      <ContextMenu />
    </>
  );
}
