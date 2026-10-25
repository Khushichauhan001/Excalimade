import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface ToggleOption<T> {
  value: T;
  /** Accessible label + tooltip. */
  label: string;
  icon?: ReactNode;
  /** Custom content instead of an icon (e.g. "S", "M", "L"). */
  content?: ReactNode;
  disabled?: boolean;
}

export interface ToggleGroupProps<T> {
  options: ToggleOption<T>[];
  /** Current value; `undefined` = mixed (nothing checked). */
  value: T | undefined;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

/** Radio-style segmented control with roving focus (arrow keys move & select). */
export function ToggleGroup<T>({ options, value, onChange, ariaLabel, className }: ToggleGroupProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const checkedIdx = options.findIndex((o) => o.value === value);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const cur = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(cur + dir + buttons.length) % buttons.length];
    next?.focus();
    next?.click();
  };

  return (
    <div ref={ref} role="radiogroup" aria-label={ariaLabel} className={`ui-toggle-group ${className ?? ""}`} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const checked = i === checkedIdx;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.label}
            title={o.label}
            disabled={o.disabled}
            tabIndex={checked || (checkedIdx < 0 && i === 0) ? 0 : -1}
            className={`ui-toggle ${checked ? "is-active" : ""}`}
            onClick={() => onChange(o.value)}
          >
            {o.icon ?? o.content ?? o.label}
          </button>
        );
      })}
    </div>
  );
}
