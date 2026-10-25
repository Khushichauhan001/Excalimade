import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icons } from "../icons";
import { Popover } from "./Popover";
import {
  CANVAS_DARK,
  CANVAS_LIGHT,
  QUICK_BACKGROUND,
  QUICK_STROKE,
  SHADES,
  TRANSPARENT,
  findHue,
  isDarkColor,
  isValidColor,
  normalizeColor,
  paletteGrid,
  type PaletteKind,
} from "../lib/colors";
import { useDevice } from "../../core/useDevice";

export interface ColorPickerProps {
  /** Section label, e.g. "Stroke". Used for aria labels and the popover title. */
  label: string;
  type: PaletteKind;
  /** Current color; `undefined` when the selection has mixed colors. */
  color: string | undefined;
  onChange(color: string): void;
  /** Inline quick swatches (defaults depend on `type`). Pass [] to show only the picker button. */
  quickColors?: string[];
}

const same = (a: string | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

export function Swatch({
  color,
  active,
  label,
  onClick,
  size = "md",
}: {
  color: string;
  active?: boolean;
  label: string;
  onClick(): void;
  size?: "sm" | "md";
}) {
  return (
    <button
      type="button"
      className={`ui-swatch ui-swatch--${size} ${active ? "is-active" : ""} ${color === TRANSPARENT ? "is-transparent" : ""}`}
      style={{ "--swatch": color === TRANSPARENT ? "transparent" : color } as CSSProperties}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
    >
      {active && <span className={`ui-swatch__check ${isDarkColor(color) ? "is-light" : ""}`}>{Icons.check}</span>}
    </button>
  );
}

/** Inline quick swatches + a button that opens the full palette popover. */
export function ColorPicker({ label, type, color, onChange, quickColors }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const device = useDevice();
  const quick = quickColors ?? (type === "stroke" ? QUICK_STROKE : type === "background" ? QUICK_BACKGROUND : CANVAS_LIGHT);
  const current = color ?? "";

  return (
    <div className="ui-color-picker">
      {quick.length > 0 && (
        <div className="ui-swatch-row" role="group" aria-label={`${label} quick colors`}>
          {quick.map((c) => (
            <Swatch key={c} color={c} label={`${label}: ${c === TRANSPARENT ? "transparent" : c}`} active={same(color, c)} onClick={() => onChange(c)} />
          ))}
        </div>
      )}
      {quick.length > 0 && <span className="ui-color-picker__divider" aria-hidden="true" />}
      <button
        ref={anchorRef}
        type="button"
        className={`ui-swatch ui-swatch--md ui-swatch--current ${color === TRANSPARENT ? "is-transparent" : ""} ${color === undefined ? "is-mixed" : ""} ${open ? "is-open" : ""}`}
        style={{ "--swatch": color && color !== TRANSPARENT ? color : "transparent" } as CSSProperties}
        aria-label={`${label} color picker${color ? `, current ${color}` : ", mixed"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${label}: more colors`}
        onClick={() => setOpen((o) => !o)}
      >
        {color === undefined && <span className="ui-swatch__mixed">?</span>}
      </button>
      {open && (
        <Popover
          anchor={anchorRef.current}
          onClose={() => setOpen(false)}
          placement={device.isMobile ? "top" : "right"}
          align={device.isMobile ? "center" : "start"}
          offset={device.isMobile ? 8 : 20}
          ariaLabel={`${label} colors`}
          className="ui-color-popover"
        >
          <ColorPalette label={label} type={type} color={current} onChange={onChange} />
        </Popover>
      )}
    </div>
  );
}

interface EyeDropperCtor {
  new (): { open(): Promise<{ sRGBHex: string }> };
}

/** Full palette grid, shades of the current hue, hex input and eyedropper. */
export function ColorPalette({ label, type, color, onChange }: { label: string; type: PaletteKind; color: string; onChange(c: string): void }) {
  const hue = findHue(color);
  const [hex, setHex] = useState(color === TRANSPARENT ? "" : color.replace(/^#/, ""));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setHex(color === TRANSPARENT ? "" : color.replace(/^#/, ""));
    setInvalid(false);
  }, [color]);

  const ED = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  const pickFromScreen = async () => {
    if (!ED) return;
    try {
      const r = await new ED().open();
      onChange(r.sRGBHex.toLowerCase());
    } catch {
      /* cancelled */
    }
  };

  const commitHex = () => {
    const v = hex.trim();
    if (!v) return;
    if (!isValidColor(v)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(normalizeColor(v));
  };

  const grid = paletteGrid(type).filter((e) => type !== "canvas" || e.color !== TRANSPARENT);

  return (
    <div className="ui-palette">
      {type === "canvas" && (
        <>
          <div className="ui-palette__heading">Light</div>
          <div className="ui-palette__grid">
            {CANVAS_LIGHT.map((c) => (
              <Swatch key={c} color={c} label={`Canvas ${c}`} active={same(color, c)} onClick={() => onChange(c)} />
            ))}
          </div>
          <div className="ui-palette__heading">Dark</div>
          <div className="ui-palette__grid">
            {CANVAS_DARK.map((c) => (
              <Swatch key={c} color={c} label={`Canvas ${c}`} active={same(color, c)} onClick={() => onChange(c)} />
            ))}
          </div>
        </>
      )}
      <div className="ui-palette__heading">Colors</div>
      <div className="ui-palette__grid">
        {grid.map((e) => {
          const active = same(color, e.color) || (!!e.hue && e.hue === hue);
          return <Swatch key={e.name} color={e.color} label={`${e.name}`} active={active} onClick={() => onChange(e.color)} />;
        })}
      </div>
      <div className="ui-palette__heading">Shades</div>
      {hue ? (
        <div className="ui-palette__grid">
          {SHADES[hue].map((c, i) => (
            <Swatch key={c} color={c} label={`${hue} shade ${i + 1}`} active={same(color, c)} onClick={() => onChange(c)} />
          ))}
        </div>
      ) : (
        <div className="ui-palette__hint">No shades available for this color</div>
      )}
      <div className="ui-palette__heading">Hex code</div>
      <div className="ui-palette__hex-row">
        <label className={`ui-hex-input ${invalid ? "is-invalid" : ""}`}>
          <span aria-hidden="true">#</span>
          <input
            value={hex}
            spellCheck={false}
            aria-label={`${label} hex color`}
            aria-invalid={invalid}
            placeholder={color === TRANSPARENT ? "transparent" : "1e1e1e"}
            onChange={(e) => {
              setHex(e.target.value.replace(/^#/, ""));
              setInvalid(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitHex();
              }
            }}
            onBlur={commitHex}
          />
        </label>
        {ED && (
          <button type="button" className="ui-icon-btn" aria-label="Pick a color from the screen" title="Eyedropper — pick from screen" onClick={pickFromScreen}>
            {Icons.eyedropper}
          </button>
        )}
      </div>
    </div>
  );
}
