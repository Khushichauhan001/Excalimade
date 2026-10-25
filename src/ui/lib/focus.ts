const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const focusables = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);

/** Keep Tab / Shift+Tab cycling inside `root`. Call from a keydown handler. */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault(): void }, root: HTMLElement | null) {
  if (e.key !== "Tab" || !root) return;
  const list = focusables(root);
  if (!list.length) {
    e.preventDefault();
    return;
  }
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

/** Focus the element marked [data-autofocus], else the first focusable, else the root. */
export function focusInitial(root: HTMLElement) {
  const target = root.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(root)[0] ?? root;
  target.focus({ preventScroll: true });
}
