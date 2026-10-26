import { useEffect, useRef, useState } from "react";
import { getState, useStore } from "../core/store";
import { getAction } from "../core/actions";
import { MenuItem, MenuSeparator } from "./components/Menu";
import { useActionsVersion } from "./lib/hooks";
import { CANVAS_LIGHT } from "./lib/colors";

// [action id, label override]; items whose action isn't registered are skipped
const SECTIONS: [string, string?][][] = [
  [["workspace.toggle"], ["workspace.newScene"]],
  [["io.open"], ["io.save"], ["io.saveAs"], ["io.exportImage"], ["io.exportPdf"], ["cloud.saveAs", "Save to Excalimade+"]],
  [["collab.start", "Live collaboration…"], ["io.present", "Present frames"], ["ui.commandPalette"], ["ui.find"], ["ui.help"], ["edit.clearCanvas", "Reset the canvas"]],
  [["cloud.open", "My scenes (sign in)"], ["io.install"]],
];

export function MainMenu() {
  useActionsVersion();
  const [open, setOpen] = useState(false);
  const theme = useStore((s) => s.appState.theme);
  const bg = useStore((s) => s.appState.viewBackgroundColor);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  const run = (id: string) => {
    setOpen(false);
    const a = getAction(id);
    a?.perform(getState(), "ui");
  };

  return (
    <div className="ui-mainmenu" ref={ref}>
      <button className="ui-icon-btn ui-island" aria-label="Main menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 6h12M4 10h12M4 14h12" /></svg>
      </button>
      {open && (
        <div className="ui-menu ui-mainmenu__panel" role="menu">
          {SECTIONS.map((sec, i) => {
            const items = sec.filter(([id]) => getAction(id));
            if (!items.length) return null;
            return (
              <div key={i}>
                {i > 0 && <MenuSeparator />}
                {items.map(([id, label]) => {
                  const a = getAction(id)!;
                  return <MenuItem key={id} label={label ?? a.label} shortcut={a.shortcuts?.[0]} onSelect={() => run(id)} />;
                })}
              </div>
            );
          })}
          <MenuSeparator />
          <MenuItem
            label={theme === "dark" ? "Light mode" : "Dark mode"}
            shortcut="Alt+Shift+D"
            onSelect={() => getState().setAppState({ theme: theme === "dark" ? "light" : "dark" })}
          />
          <div className="ui-menu-heading">Canvas background</div>
          <div className="ui-swatch-row" style={{ padding: "0 6px 6px" }}>
            {CANVAS_LIGHT.map((c) => (
              <button
                key={c}
                className={`ui-swatch ${bg === c ? "is-active" : ""}`}
                style={{ background: c, filter: theme === "dark" ? "invert(93%) hue-rotate(180deg)" : undefined }}
                aria-label={`Background ${c}`}
                onClick={() => getState().setAppState({ viewBackgroundColor: c })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
