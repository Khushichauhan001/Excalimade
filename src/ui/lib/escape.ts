// A stack of Escape handlers so the topmost popover / dialog / menu closes first,
// before the global shortcut handler gets to deselect or switch tools.
const stack: (() => void)[] = [];
let installed = false;

const onKey = (e: KeyboardEvent) => {
  if (e.key !== "Escape" || !stack.length) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  stack[stack.length - 1]();
};

export function pushEscape(fn: () => void) {
  if (!installed && typeof window !== "undefined") {
    window.addEventListener("keydown", onKey, true);
    installed = true;
  }
  stack.push(fn);
  return () => {
    const i = stack.lastIndexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}

export const hasEscapeLayer = () => stack.length > 0;
