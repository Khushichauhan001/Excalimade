import { useRef, useState, type ReactNode } from "react";
import { useStore } from "../core/store";
import type { DialogName, ToolType } from "../core/types";
import { Icons } from "./icons";
import { Popover } from "./components/Popover";
import { MenuHeading, MenuItem, MenuSeparator, menuKeyDown } from "./components/Menu";
import { EXTENDED_SHAPES, setTool, useLastShape } from "./lib/tools";
import { toolDef } from "./actions";
import { prettyShortcut } from "./lib/shortcuts";

const MAIN_TOOLS: ToolType[] = ["selection", "rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image", "eraser"];
const MORE_TOOLS: ToolType[] = ["frame", "embeddable", "laser"];

const ICON: Partial<Record<ToolType, ReactNode>> = {
  hand: Icons.hand,
  selection: Icons.selection,
  rectangle: Icons.rectangle,
  diamond: Icons.diamond,
  ellipse: Icons.ellipse,
  arrow: Icons.arrow,
  line: Icons.line,
  freedraw: Icons.freedraw,
  text: Icons.text,
  image: Icons.image,
  eraser: Icons.eraser,
  frame: Icons.frame,
  embeddable: Icons.embed,
  laser: Icons.laser,
  triangle: Icons.triangle,
  star: Icons.star,
  hexagon: Icons.hexagon,
  cylinder: Icons.cylinder,
  cloud: Icons.cloud,
  callout: Icons.callout,
};

export const toolIcon = (t: ToolType) => ICON[t] ?? Icons.selection;

function toolTitle(t: ToolType) {
  const d = toolDef(t);
  if (!d) return t;
  const sc = d.shortcuts?.map(prettyShortcut).join(" or ");
  return sc ? `${d.label} — ${sc}` : d.label;
}

function ToolButton({ tool, active, showDigit }: { tool: ToolType; active: boolean; showDigit: boolean }) {
  const d = toolDef(tool);
  const digit = d?.shortcuts?.find((s) => /^\d$/.test(s));
  return (
    <button
      type="button"
      className={`ui-tool ${active ? "is-active" : ""}`}
      aria-label={d?.label ?? tool}
      aria-pressed={active}
      title={toolTitle(tool)}
      data-testid={`tool-${tool}`}
      onClick={() => setTool(tool)}
    >
      {toolIcon(tool)}
      {showDigit && digit && <span className="ui-tool__key">{digit}</span>}
    </button>
  );
}

function ShapesDropdown({ activeTool }: { activeTool: ToolType }) {
  const last = useLastShape();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isActive = (EXTENDED_SHAPES as string[]).includes(activeTool);
  const shown = isActive ? (activeTool as (typeof EXTENDED_SHAPES)[number]) : last;
  return (
    <div className="ui-tool-split" ref={ref}>
      <button
        type="button"
        className={`ui-tool ${isActive ? "is-active" : ""}`}
        aria-label={`${toolDef(shown)?.label ?? shown} (more shapes)`}
        aria-pressed={isActive}
        title={`${toolDef(shown)?.label ?? shown} — click again for more shapes`}
        onClick={() => (isActive ? setOpen((o) => !o) : setTool(shown))}
      >
        {toolIcon(shown)}
      </button>
      <button
        type="button"
        className={`ui-tool-split__caret ${open ? "is-open" : ""}`}
        aria-label="More shapes"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More shapes"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
          <path d="M1 2.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} placement="bottom" align="center" role="menu" ariaLabel="Shapes" className="ui-shapes-popover">
          <div className="ui-shapes-grid" onKeyDown={menuKeyDown}>
            {EXTENDED_SHAPES.map((t) => (
              <button
                key={t}
                type="button"
                role="menuitem"
                className={`ui-shape-option ${activeTool === t ? "is-active" : ""}`}
                aria-label={toolDef(t)?.label ?? t}
                title={toolDef(t)?.label ?? t}
                onClick={() => {
                  setTool(t);
                  setOpen(false);
                }}
              >
                {toolIcon(t)}
                <span>{toolDef(t)?.label ?? t}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

const GENERATE: { dialog: NonNullable<DialogName>; label: string; icon: ReactNode }[] = [
  { dialog: "mermaid", label: "Mermaid to Excalimade", icon: Icons.mermaid },
  { dialog: "text-to-diagram", label: "Text to diagram", icon: Icons.sparkles },
  { dialog: "wireframe-to-code", label: "Wireframe to code", icon: Icons.wireframe },
  { dialog: "chart", label: "Chart from data", icon: Icons.chart },
];

function MoreToolsDropdown({ activeTool }: { activeTool: ToolType }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const setAppState = useStore((s) => s.setAppState);
  const isActive = MORE_TOOLS.includes(activeTool);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`ui-tool ${isActive ? "is-active" : ""} ${open ? "is-open" : ""}`}
        aria-label="More tools"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More tools"
        onClick={() => setOpen((o) => !o)}
      >
        {isActive ? toolIcon(activeTool) : Icons.moreTools}
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} placement="bottom" align="end" role="menu" ariaLabel="More tools" className="ui-menu">
          <div onKeyDown={menuKeyDown}>
            {MORE_TOOLS.map((t) => (
              <MenuItem
                key={t}
                icon={toolIcon(t)}
                label={toolDef(t)?.label ?? t}
                shortcut={toolDef(t)?.shortcuts?.[0]}
                checked={undefined}
                onSelect={() => {
                  setOpen(false);
                  setTool(t);
                }}
              />
            ))}
            <MenuSeparator />
            <MenuHeading>Generate</MenuHeading>
            {GENERATE.map((g) => (
              <MenuItem
                key={g.dialog}
                icon={g.icon}
                label={g.label}
                onSelect={() => {
                  setOpen(false);
                  setAppState({ openDialog: g.dialog, openMenu: null });
                }}
              />
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

export function Toolbar({ mobile = false, extra }: { mobile?: boolean; extra?: ReactNode }) {
  const activeTool = useStore((s) => s.appState.activeTool);
  const toolLocked = useStore((s) => s.appState.toolLocked);
  const setAppState = useStore((s) => s.setAppState);
  return (
    <div className={`ui-toolbar ui-island ${mobile ? "ui-toolbar--mobile" : ""}`} role="toolbar" aria-label="Tools">
      {extra}
      <button
        type="button"
        className={`ui-tool ui-tool--lock ${toolLocked ? "is-active" : ""}`}
        aria-label="Keep selected tool active after drawing"
        aria-pressed={toolLocked}
        title={`Keep selected tool active after drawing — ${prettyShortcut("Q")}`}
        onClick={() => setAppState({ toolLocked: !toolLocked })}
      >
        {toolLocked ? Icons.lockClosed : Icons.lockOpen}
      </button>
      <span className="ui-toolbar__sep" aria-hidden="true" />
      <ToolButton tool="hand" active={activeTool === "hand"} showDigit={!mobile} />
      {MAIN_TOOLS.map((t) => (
        <ToolGroupItem key={t} tool={t} activeTool={activeTool} mobile={mobile} />
      ))}
      <span className="ui-toolbar__sep" aria-hidden="true" />
      <MoreToolsDropdown activeTool={activeTool} />
    </div>
  );
}

function ToolGroupItem({ tool, activeTool, mobile }: { tool: ToolType; activeTool: ToolType; mobile: boolean }) {
  return (
    <>
      <ToolButton tool={tool} active={activeTool === tool} showDigit={!mobile} />
      {tool === "ellipse" && <ShapesDropdown activeTool={activeTool} />}
    </>
  );
}
