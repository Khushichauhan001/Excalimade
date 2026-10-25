// Service worker registration (production only), install prompt and online/offline toasts.
import { showToast } from "../core/store";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

export const canInstall = () => !!deferredPrompt;
export const subscribeInstall = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export async function promptInstall() {
  if (!deferredPrompt) {
    showToast("Use your browser menu → “Install app” / “Add to Home Screen”.", "info");
    return;
  }
  const p = deferredPrompt;
  deferredPrompt = null;
  notify();
  await p.prompt();
  const { outcome } = await p.userChoice;
  if (outcome === "accepted") showToast("Excalimade installed", "success");
}

let initialised = false;
export function initPWA() {
  if (initialised || typeof window === "undefined") return;
  initialised = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
  window.addEventListener("offline", () => showToast("You're offline — changes are still saved in this browser.", "info"));
  window.addEventListener("online", () => showToast("Back online", "success"));

  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    const register = () =>
      navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service worker registration failed", err));
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", () => void register(), { once: true });
  }
}
