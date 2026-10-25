import { useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { getState, useStore } from "../core/store";
import { getAction } from "../core/actions";
import { FONTS, QUICK_FONTS, getFontCss } from "../core/text";
import {
  SHAPE_TYPES,
  type Arrowhead,
  type ArrowType,
  type ExcalidrawElement,
  type FillStyle,
  type LinearElement,
  type Roundness,
  type StrokeStyle,
  type TextAlign,
  type TextElement,
  type ToolType,
  type VerticalAlign,
} from "../core/types";
import { ArrowheadIcon, Icons } from "./icons";
import { ColorPicker } from "./components/ColorPicker";
import { ToggleGroup } from "./components/ToggleGroup";
import { Popover } from "./components/Popover";
import { applyStyle, applyTextStyle, common } from "./lib/style";
import { byId, getBoundText, getUnits, isBoundText, isShape, isText } from "./lib/scene";
import { convertSelection } from "./actions";
import { toolIcon } from "./Toolbar";
import { prettyShortcut } from "./lib/shortcuts";
import { useDevice } from "../core/useDevice";

type Kind = ExcalidrawElement["type"];

const SHAPES = new Set<string>(SHAPE_TYPES);
const EDGE_KINDS = new Set<string>(["rectangle", "diamond", "triangle", "hexagon", "star", "callout", "line", "embeddable", "image"]);
const STROKE_KINDS = new Set<string>([...SHAPE_TYPES, "arrow", "line", "freedraw"]);
const SLOPPY_KINDS = new Set<string>([...SHAPE_TYPES, "arrow", "line"]);
const TOOL_PANEL: ToolType[] = [...SHAPE_TYPES, "arrow", "line", "freedraw", "text"];

const FONT_SIZES = [
  { value: 16, label: "Small", content: "S" },
  { value: 20, label: "Medium", content: "M" },
  { value: 28, label: "Large", content: "L" },
  { value: 36, label: "Extra large", content: "XL" },
];

const ARROWHEADS: { value: Arrowhead; label: string }[] = [
  { value: null, label: "None" },
  { value: "arrow", label: "Arrow" },
  { value: "bar", label: "Bar" },
  { value: "dot", label: "Dot" },
  { value: "circle", label: "Circle" },
  { value: "circle_outline", label: "Circle (outline)" },
  { value: "triangle", label: "Triangle" },
  { value: "triangle_outline", label: "Triangle (outline)" },
  { value: "diamond", label: "Diamond" },
  { value: "diamond_outline", label: "Diamond (outline)" },
  { value: "crowfoot_one", label: "Crow's foot: one" },
  { value: "crowfoot_many", label: "Crow's foot: many" },
  { value: "crowfoot_one_or_many", label: "Crow's foot: one or many" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="ui-panel-section">
      <legend className="ui-panel-section__title">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Computes everything the panel shows from the selection (or the active tool when nothing is selected). */
function usePanelModel() {
  const { activeTool, selectedElementIds, editingTextId, viewModeEnabled, editingGroupId } = useStore(
    useShallow((s) => ({
      activeTool: s.appState.activeTool,
      selectedElementIds: s.appState.selectedElementIds,
      editingTextId: s.appState.editingTextId,
      viewModeEnabled: s.appState.viewModeEnabled,
      editingGroupId: s.appState.editingGroupId,
    })),
  );
  const elements = useStore((s) => s.elements);
  return useMemo(() => {
    const map = byId(elements);
    const selected = elements.filter((e) => !e.isDeleted && selectedElementIds[e.id]);
    const editing = editingTextId ? map.get(editingTextId) : undefined;
    if (editing && !editing.isDeleted && !selected.length) {
      selected.push(isBoundText(editing) ? (map.get(editing.containerId!) ?? editing) : editing);
    }
    const selIds = new Set(selected.map((e) => e.id));
    const targets = selected.filter((e) => !e.locked && !(isBoundText(e) && selIds.has(e.containerId!)));
    const fromTool = selected.length === 0;
    const kinds = new Set<Kind>(fromTool ? (TOOL_PANEL.includes(activeTool) ? [activeTool as Kind] : []) : targets.map((e) => e.type));
    const texts: TextElement[] = [];
    for (const el of targets) {
      if (isText(el)) texts.push(el);
      else {
        const t = getBoundText(el, map);
        if (t) texts.push(t);
      }
    }
    if (editing && isText(editing) && !texts.some((t) => t.id === editing.id)) texts.push(editing);
    const units = fromTool ? 0 : getUnits(targets, elements, editingGroupId).length;
    return { selected, targets, fromTool, kinds, texts, units, activeTool, viewModeEnabled };
  }, [elements, selectedElementIds, editingTextId, activeTool, viewModeEnabled, editingGroupId]);
}

export function usePanelVisible() {
  const m = usePanelModel();
  return !m.viewModeEnabled && (m.selected.length > 0 || m.kinds.size > 0);
}

export function PropertiesPanel({ className = "" }: { className?: string }) {
  const m = usePanelModel();
  const as = useStore(
    useShallow((s) => ({
      stroke: s.appState.currentItemStrokeColor,
      bg: s.appState.currentItemBackgroundColor,
      fill: s.appState.currentItemFillStyle,
      width: s.appState.currentItemStrokeWidth,
      style: s.appState.currentItemStrokeStyle,
      rough: s.appState.currentItemRoughness,
      round: s.appState.currentItemRoundness,
      opacity: s.appState.currentItemOpacity,
      font: s.appState.currentItemFontFamily,
      size: s.appState.currentItemFontSize,
      align: s.appState.currentItemTextAlign,
      startHead: s.appState.currentItemStartArrowhead,
      endHead: s.appState.currentItemEndArrowhead,
      arrowType: s.appState.currentItemArrowType,
    })),
  );
  const { targets, fromTool, kinds, texts, selected, units } = m;
  const has = (set: Set<string>) => [...kinds].some((k) => set.has(k));
  const val = <T,>(get: (el: ExcalidrawElement) => T, fallback: T, list: ExcalidrawElement[] = targets) =>
    fromTool ? fallback : common(list.map(get), fallback);

  if (m.viewModeEnabled || (!selected.length && !kinds.size)) return null;

  const allLocked = selected.length > 0 && targets.length === 0;
  const closedLine = targets.some((e) => e.type === "line" && (e as LinearElement).polygon);
  const showStroke = !allLocked && [...kinds].some((k) => k !== "image" && k !== "frame");
  const showBg = has(SHAPES) || closedLine || kinds.has("embeddable");
  const bgValue = val((e) => e.backgroundColor, as.bg);
  const showFill = showBg && (bgValue === undefined || bgValue !== "transparent");
  const showWidth = has(STROKE_KINDS);
  const showStrokeStyle = has(SLOPPY_KINDS);
  const showSloppy = has(SLOPPY_KINDS);
  const showEdges = has(EDGE_KINDS);
  const arrows = targets.filter((e) => e.type === "arrow") as LinearElement[];
  const showArrow = kinds.has("arrow");
  const showFont = texts.length > 0 || (fromTool && m.activeTool === "text");
  const showVAlign = texts.some((t) => t.containerId);
  const showConvert = !fromTool && targets.length > 0 && targets.every(isShape);
  const nonText = targets.filter((e) => !isText(e));
  const colorTargets = targets;

  const textVal = <T,>(get: (t: TextElement) => T, fallback: T) => (texts.length ? common(texts.map(get), fallback) : fallback);

  const run = (id: string) => {
    const a = getAction(id);
    const s = getState();
    if (a && (!a.predicate || a.predicate(s))) a.perform(s, "ui");
  };
  const enabled = (id: string) => {
    const a = getAction(id);
    return !!a && (!a.predicate || a.predicate(getState()));
  };

  return (
    <div className={`ui-panel ui-island ${className}`} role="region" aria-label="Element properties" onPointerDown={(e) => e.stopPropagation()}>
      {showStroke && (
        <Section title="Stroke">
          <ColorPicker
            label="Stroke"
            type="stroke"
            color={val((e) => e.strokeColor, as.stroke, colorTargets)}
            onChange={(c) => applyStyle(() => ({ strokeColor: c }), { currentItemStrokeColor: c }, { boundText: true })}
          />
        </Section>
      )}
      {showBg && (
        <Section title="Background">
          <ColorPicker
            label="Background"
            type="background"
            color={bgValue}
            onChange={(c) =>
              applyStyle((e) => (isText(e) ? null : { backgroundColor: c }), { currentItemBackgroundColor: c })
            }
          />
        </Section>
      )}
      {showFill && (
        <Section title="Fill">
          <ToggleGroup<FillStyle>
            ariaLabel="Fill"
            value={val((e) => e.fillStyle, as.fill, nonText)}
            onChange={(v) => applyStyle((e) => (isText(e) ? null : { fillStyle: v }), { currentItemFillStyle: v })}
            options={[
              { value: "hachure", label: "Hachure", icon: Icons.fillHachure },
              { value: "cross-hatch", label: "Cross-hatch", icon: Icons.fillCrossHatch },
              { value: "solid", label: "Solid", icon: Icons.fillSolid },
              { value: "zigzag", label: "Zigzag", icon: Icons.fillZigzag },
              { value: "dots", label: "Dots", icon: Icons.fillDots },
            ]}
          />
        </Section>
      )}
      {showWidth && (
        <Section title="Stroke width">
          <ToggleGroup<number>
            ariaLabel="Stroke width"
            value={val((e) => e.strokeWidth, as.width, nonText)}
            onChange={(v) => applyStyle((e) => (isText(e) ? null : { strokeWidth: v }), { currentItemStrokeWidth: v })}
            options={[
              { value: 1, label: "Thin", icon: Icons.strokeThin },
              { value: 2, label: "Bold", icon: Icons.strokeBold },
              { value: 4, label: "Extra bold", icon: Icons.strokeExtraBold },
            ]}
          />
        </Section>
      )}
      {showStrokeStyle && (
        <Section title="Stroke style">
          <ToggleGroup<StrokeStyle>
            ariaLabel="Stroke style"
            value={val((e) => e.strokeStyle, as.style, nonText)}
            onChange={(v) => applyStyle((e) => (isText(e) ? null : { strokeStyle: v }), { currentItemStrokeStyle: v })}
            options={[
              { value: "solid", label: "Solid", icon: Icons.strokeSolid },
              { value: "dashed", label: "Dashed", icon: Icons.strokeDashed },
              { value: "dotted", label: "Dotted", icon: Icons.strokeDotted },
            ]}
          />
        </Section>
      )}
      {showSloppy && (
        <Section title="Sloppiness">
          <ToggleGroup<number>
            ariaLabel="Sloppiness"
            value={val((e) => e.roughness, as.rough, nonText)}
            onChange={(v) => applyStyle((e) => (isText(e) ? null : { roughness: v }), { currentItemRoughness: v })}
            options={[
              { value: 0, label: "Architect", icon: Icons.sloppyArchitect },
              { value: 1, label: "Artist", icon: Icons.sloppyArtist },
              { value: 2, label: "Cartoonist", icon: Icons.sloppyCartoonist },
            ]}
          />
        </Section>
      )}
      {showEdges && (
        <Section title="Edges">
          <ToggleGroup<Roundness>
            ariaLabel="Edges"
            value={val((e) => e.roundness, as.round, targets.filter((e) => EDGE_KINDS.has(e.type)))}
            onChange={(v) =>
              applyStyle((e) => (EDGE_KINDS.has(e.type) ? { roundness: v } : null), { currentItemRoundness: v }, { relayoutIds: true })
            }
            options={[
              { value: "sharp", label: "Sharp", icon: Icons.edgeSharp },
              { value: "round", label: "Round", icon: Icons.edgeRound },
            ]}
          />
        </Section>
      )}
      {showArrow && (
        <>
          <Section title="Arrow type">
            <ToggleGroup<ArrowType>
              ariaLabel="Arrow type"
              value={fromTool ? as.arrowType : common(arrows.map((a) => a.arrowType), as.arrowType)}
              onChange={(v) =>
                applyStyle((e) => (e.type === "arrow" ? { arrowType: v } : null), { currentItemArrowType: v }, { relayoutIds: true })
              }
              options={[
                { value: "sharp", label: "Sharp arrow", icon: Icons.arrowSharp },
                { value: "round", label: "Curved arrow", icon: Icons.arrowCurved },
                { value: "elbow", label: "Elbow arrow", icon: Icons.arrowElbow },
              ]}
            />
          </Section>
          <Section title="Arrowheads">
            <div className="ui-row">
              <ArrowheadPicker
                start
                value={fromTool ? as.startHead : common(arrows.map((a) => a.startArrowhead), as.startHead)}
                onChange={(v) =>
                  applyStyle((e) => (e.type === "arrow" ? { startArrowhead: v } : null), { currentItemStartArrowhead: v })
                }
              />
              <ArrowheadPicker
                value={fromTool ? as.endHead : common(arrows.map((a) => a.endArrowhead), as.endHead)}
                onChange={(v) =>
                  applyStyle((e) => (e.type === "arrow" ? { endArrowhead: v } : null), { currentItemEndArrowhead: v })
                }
              />
            </div>
          </Section>
        </>
      )}
      {showFont && (
        <>
          <Section title="Font family">
            <FontFamilyControl
              value={textVal((t) => t.fontFamily, as.font)}
              onChange={(v) => applyTextStyle({ fontFamily: v }, { currentItemFontFamily: v })}
            />
          </Section>
          <Section title="Font size">
            <ToggleGroup<number>
              ariaLabel="Font size"
              value={textVal((t) => t.fontSize, as.size)}
              onChange={(v) => applyTextStyle({ fontSize: v }, { currentItemFontSize: v })}
              options={FONT_SIZES.map((f) => ({ value: f.value, label: f.label, content: <span className="ui-toggle__text">{f.content}</span> }))}
            />
          </Section>
          <Section title="Text align">
            <div className="ui-row">
              <ToggleGroup<TextAlign>
                ariaLabel="Text align"
                value={textVal((t) => t.textAlign, as.align)}
                onChange={(v) => applyTextStyle({ textAlign: v }, { currentItemTextAlign: v })}
                options={[
                  { value: "left", label: "Align left", icon: Icons.textLeft },
                  { value: "center", label: "Align center", icon: Icons.textCenter },
                  { value: "right", label: "Align right", icon: Icons.textRight },
                ]}
              />
            </div>
            {showVAlign && (
              <div className="ui-row ui-row--spaced">
                <ToggleGroup<VerticalAlign>
                  ariaLabel="Vertical align"
                  value={textVal((t) => t.verticalAlign, "middle")}
                  onChange={(v) => applyTextStyle({ verticalAlign: v }, {})}
                  options={[
                    { value: "top", label: "Align top", icon: Icons.vAlignTop },
                    { value: "middle", label: "Align middle", icon: Icons.vAlignMiddle },
                    { value: "bottom", label: "Align bottom", icon: Icons.vAlignBottom },
                  ]}
                />
              </div>
            )}
          </Section>
        </>
      )}
      {!allLocked && (
        <Section title="Opacity">
          <OpacitySlider value={val((e) => e.opacity, as.opacity) ?? 100} />
        </Section>
      )}
      {showConvert && (
        <Section title="Shape">
          <div className="ui-icon-grid" role="group" aria-label="Convert shape">
            {SHAPE_TYPES.map((t) => {
              const active = targets.every((e) => e.type === t);
              return (
                <button
                  key={t}
                  type="button"
                  className={`ui-toggle ${active ? "is-active" : ""}`}
                  aria-pressed={active}
                  aria-label={`Convert to ${t}`}
                  title={`Convert to ${t}`}
                  onClick={() => convertSelection(t)}
                >
                  {toolIcon(t)}
                </button>
              );
            })}
          </div>
        </Section>
      )}
      {!fromTool && !allLocked && (
        <Section title="Layers">
          <div className="ui-icon-grid">
            <ActionButton id="layer.sendToBack" icon={Icons.sendToBack} run={run} enabled={enabled} />
            <ActionButton id="layer.sendBackward" icon={Icons.sendBackward} run={run} enabled={enabled} />
            <ActionButton id="layer.bringForward" icon={Icons.bringForward} run={run} enabled={enabled} />
            <ActionButton id="layer.bringToFront" icon={Icons.bringToFront} run={run} enabled={enabled} />
          </div>
        </Section>
      )}
      {!fromTool && units >= 2 && (
        <Section title="Align">
          <div className="ui-icon-grid">
            <ActionButton id="align.left" icon={Icons.alignLeft} run={run} enabled={enabled} />
            <ActionButton id="align.centerH" icon={Icons.alignCenterH} run={run} enabled={enabled} />
            <ActionButton id="align.right" icon={Icons.alignRight} run={run} enabled={enabled} />
            {units >= 3 && <ActionButton id="distribute.horizontal" icon={Icons.distributeH} run={run} enabled={enabled} />}
            <ActionButton id="align.top" icon={Icons.alignTop} run={run} enabled={enabled} />
            <ActionButton id="align.centerV" icon={Icons.alignCenterV} run={run} enabled={enabled} />
            <ActionButton id="align.bottom" icon={Icons.alignBottom} run={run} enabled={enabled} />
            {units >= 3 && <ActionButton id="distribute.vertical" icon={Icons.distributeV} run={run} enabled={enabled} />}
          </div>
        </Section>
      )}
      {!fromTool && (
        <Section title="Actions">
          <div className="ui-icon-grid">
            {!allLocked && <ActionButton id="edit.duplicate" icon={Icons.duplicate} run={run} enabled={enabled} />}
            {!allLocked && <ActionButton id="edit.delete" icon={Icons.trash} run={run} enabled={enabled} />}
            {enabled("edit.group") && <ActionButton id="edit.group" icon={Icons.group} run={run} enabled={enabled} />}
            {enabled("edit.ungroup") && <ActionButton id="edit.ungroup" icon={Icons.ungroup} run={run} enabled={enabled} />}
            {enabled("edit.link") && <ActionButton id="edit.link" icon={Icons.link} run={run} enabled={enabled} />}
            <ActionButton
              id="edit.lock"
              icon={selected.every((e) => e.locked) ? Icons.lockClosed : Icons.lockOpen}
              label={selected.every((e) => e.locked) ? "Unlock" : "Lock"}
              run={run}
              enabled={enabled}
            />
          </div>
        </Section>
      )}
    </div>
  );
}

function ActionButton({
  id,
  icon,
  label,
  run,
  enabled,
}: {
  id: string;
  icon: ReactNode;
  label?: string;
  run(id: string): void;
  enabled(id: string): boolean;
}) {
  const a = getAction(id);
  if (!a) return null;
  const name = label ?? a.label;
  const sc = a.shortcuts?.[0];
  return (
    <button
      type="button"
      className="ui-toggle"
      aria-label={name}
      title={sc ? `${name} — ${prettyShortcut(sc)}` : name}
      disabled={!enabled(id)}
      onClick={() => run(id)}
    >
      {icon}
    </button>
  );
}

function OpacitySlider({ value }: { value: number }) {
  const set = (v: number, history: boolean) =>
    applyStyle(() => ({ opacity: v }), { currentItemOpacity: v }, { boundText: true, history });
  return (
    <div className="ui-range">
      <input
        type="range"
        min={0}
        max={100}
        step={10}
        value={value}
        aria-label="Opacity"
        style={{ "--value": `${value}%` } as React.CSSProperties}
        onPointerDown={() => getState().recordHistory()}
        onKeyDown={() => getState().recordHistory()}
        onChange={(e) => set(Number(e.target.value), false)}
      />
      <span className="ui-range__value">{value}</span>
    </div>
  );
}

function ArrowheadPicker({ value, onChange, start = false }: { value: Arrowhead | undefined; onChange(v: Arrowhead): void; start?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const device = useDevice();
  const label = start ? "Start arrowhead" : "End arrowhead";
  const current = ARROWHEADS.find((a) => a.value === value);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`ui-toggle ui-toggle--wide ${open ? "is-active" : ""}`}
        aria-label={`${label}: ${current?.label ?? "mixed"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        {value === undefined ? <span className="ui-toggle__text">?</span> : <ArrowheadIcon head={value} start={start} />}
        <span className="ui-toggle__caret">{Icons.chevronDown}</span>
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} placement={device.isMobile ? "top" : "right"} offset={device.isMobile ? 8 : 20} ariaLabel={label}>
          <div className="ui-popover__title">{label}</div>
          <div className="ui-arrowhead-grid" role="listbox" aria-label={label}>
            {ARROWHEADS.map((a) => (
              <button
                key={String(a.value)}
                type="button"
                role="option"
                aria-selected={a.value === value}
                className={`ui-toggle ${a.value === value ? "is-active" : ""}`}
                title={a.label}
                aria-label={a.label}
                onClick={() => {
                  onChange(a.value);
                  setOpen(false);
                }}
              >
                <ArrowheadIcon head={a.value} start={start} />
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

function FontFamilyControl({ value, onChange }: { value: number | undefined; onChange(v: number): void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const device = useDevice();
  const isQuick = value !== undefined && QUICK_FONTS.includes(value);
  const currentName = FONTS.find((f) => f.id === value)?.name;
  return (
    <div className="ui-row">
      <div className="ui-toggle-group" role="radiogroup" aria-label="Font family">
        {QUICK_FONTS.map((id) => {
          const f = FONTS.find((x) => x.id === id)!;
          const active = value === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={f.name}
              title={f.name}
              className={`ui-toggle ${active ? "is-active" : ""}`}
              onClick={() => onChange(id)}
            >
              <span className="ui-font-sample" style={{ fontFamily: f.css }}>
                Aa
              </span>
            </button>
          );
        })}
      </div>
      <span className="ui-row__divider" aria-hidden="true" />
      <button
        ref={ref}
        type="button"
        className={`ui-toggle ${!isQuick && value !== undefined ? "is-active" : ""} ${open ? "is-open" : ""}`}
        aria-label={`More fonts${!isQuick && currentName ? ` (current: ${currentName})` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={!isQuick && currentName ? currentName : "More fonts"}
        onClick={() => setOpen((o) => !o)}
      >
        {!isQuick && value !== undefined ? (
          <span className="ui-font-sample" style={{ fontFamily: getFontCss(value) }}>
            Aa
          </span>
        ) : (
          Icons.chevronDown
        )}
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} placement={device.isMobile ? "top" : "right"} offset={device.isMobile ? 8 : 20} ariaLabel="Fonts" className="ui-font-popover">
          <FontList
            value={value}
            onPick={(id) => {
              onChange(id);
              setOpen(false);
            }}
          />
        </Popover>
      )}
    </div>
  );
}

/** Searchable list of every font rendered in its own face. Used by the panel popover and the fonts dialog. */
export function FontList({ value, onPick }: { value: number | undefined; onPick(id: number): void }) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const list = FONTS.filter((f) => f.name.toLowerCase().includes(q.trim().toLowerCase()));
  const groups: { title: string; items: typeof FONTS }[] = [
    { title: "Hand-drawn", items: list.filter((f) => f.category === "hand-drawn") },
    { title: "Normal", items: list.filter((f) => f.category === "normal") },
    { title: "Code", items: list.filter((f) => f.category === "code") },
  ];
  const flat = groups.flatMap((g) => g.items);
  return (
    <div className="ui-font-list">
      <label className="ui-search-input">
        {Icons.search}
        <input
          data-autofocus
          value={q}
          placeholder="Search fonts"
          aria-label="Search fonts"
          onChange={(e) => {
            setQ(e.target.value);
            setHi(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => Math.min(h + 1, flat.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && flat[hi]) {
              e.preventDefault();
              onPick(flat[hi].id);
            }
          }}
        />
      </label>
      <div className="ui-font-list__scroll" role="listbox" aria-label="Fonts">
        {!flat.length && <div className="ui-empty">No fonts match “{q}”</div>}
        {groups.map(
          (g) =>
            g.items.length > 0 && (
              <div key={g.title}>
                <div className="ui-menu-heading">{g.title}</div>
                {g.items.map((f) => {
                  const idx = flat.indexOf(f);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      role="option"
                      aria-selected={value === f.id}
                      className={`ui-font-option ${value === f.id ? "is-selected" : ""} ${idx === hi ? "is-highlighted" : ""}`}
                      style={{ fontFamily: f.css }}
                      onMouseEnter={() => setHi(idx)}
                      onClick={() => onPick(f.id)}
                    >
                      <span>{f.name}</span>
                      {value === f.id && <span className="ui-font-option__check">{Icons.check}</span>}
                    </button>
                  );
                })}
              </div>
            ),
        )}
      </div>
    </div>
  );
}
