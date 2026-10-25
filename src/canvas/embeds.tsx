import { useEffect, useReducer } from "react";
import { useStore } from "../core/store";
import type { EmbeddableElement } from "../core/types";
import { boundsIntersect, getElementBounds, getViewportBounds } from "../core/geometry";
import { session } from "./session";

export interface EmbedInfo {
  kind: "youtube" | "vimeo" | "figma" | "codepen" | "loom" | "spotify" | "maps" | "gist" | "tweet" | "generic";
  src?: string;
  srcdoc?: string;
  width: number;
  height: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Convert a pasted URL into an embeddable iframe source (or null if not a URL). */
export function toEmbedUrl(raw: string): EmbedInfo | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  let m: RegExpMatchArray | null;

  if (host === "youtu.be" || host.endsWith("youtube.com")) {
    const id = host === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v") ?? ((m = url.pathname.match(/\/(?:embed|shorts|live)\/([\w-]+)/)) && m[1]);
    if (id) {
      const t = url.searchParams.get("t") ?? url.searchParams.get("start");
      const start = t ? `?start=${parseInt(t, 10) || 0}` : "";
      const shorts = url.pathname.includes("/shorts/");
      return { kind: "youtube", src: `https://www.youtube.com/embed/${id}${start}`, width: shorts ? 315 : 560, height: shorts ? 560 : 315 };
    }
  }
  if (host === "vimeo.com" && (m = url.pathname.match(/\/(\d+)/))) {
    return { kind: "vimeo", src: `https://player.vimeo.com/video/${m[1]}`, width: 560, height: 315 };
  }
  if (host === "player.vimeo.com") return { kind: "vimeo", src: url.href, width: 560, height: 315 };
  if (host === "figma.com" && /^\/(file|design|proto|board|slides)\//.test(url.pathname)) {
    return { kind: "figma", src: `https://www.figma.com/embed?embed_host=excalimade&url=${encodeURIComponent(url.href)}`, width: 640, height: 480 };
  }
  if (host === "codepen.io" && (m = url.pathname.match(/^\/([^/]+)\/(?:pen|embed)\/(?:preview\/)?([^/]+)/))) {
    return { kind: "codepen", src: `https://codepen.io/${m[1]}/embed/preview/${m[2]}?default-tab=result`, width: 640, height: 420 };
  }
  if (host === "loom.com" && (m = url.pathname.match(/\/(?:share|embed)\/([\w-]+)/))) {
    return { kind: "loom", src: `https://www.loom.com/embed/${m[1]}`, width: 560, height: 350 };
  }
  if (host === "open.spotify.com" && (m = url.pathname.match(/^\/(?:embed\/)?(track|album|playlist|episode|show|artist)\/(\w+)/))) {
    return { kind: "spotify", src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, width: 400, height: m[1] === "track" ? 152 : 380 };
  }
  if ((host === "google.com" || host.startsWith("google.")) && url.pathname.startsWith("/maps")) {
    const src = url.pathname.startsWith("/maps/embed") ? url.href : `https://maps.google.com/maps?q=${encodeURIComponent(decodeURIComponent(url.pathname.split("/").filter(Boolean)[2] ?? url.searchParams.get("q") ?? ""))}&output=embed`;
    return { kind: "maps", src, width: 600, height: 400 };
  }
  if (host === "gist.github.com" && (m = url.pathname.match(/^\/([^/]+)\/(\w+)/))) {
    return {
      kind: "gist",
      srcdoc: `<!doctype html><html><head><base target="_blank"><style>body{margin:0}</style></head><body><script src="https://gist.github.com/${esc(m[1])}/${esc(m[2])}.js"></script></body></html>`,
      width: 560,
      height: 400,
    };
  }
  if ((host === "twitter.com" || host === "x.com") && /\/status\/\d+/.test(url.pathname)) {
    const tweetUrl = url.href.replace("x.com", "twitter.com");
    return {
      kind: "tweet",
      srcdoc: `<!doctype html><html><head><base target="_blank"></head><body style="margin:0;display:flex;justify-content:center"><blockquote class="twitter-tweet"><a href="${esc(tweetUrl)}"></a></blockquote><script async src="https://platform.twitter.com/widgets.js"></script></body></html>`,
      width: 480,
      height: 600,
    };
  }
  return { kind: "generic", src: url.href, width: 640, height: 420 };
}

let rerenderEmbeds = () => {};
export const refreshEmbeds = () => rerenderEmbeds();

/** DOM overlay of iframes for embeddable elements in view. */
export function EmbedsLayer() {
  const elements = useStore((s) => s.elements);
  const as = useStore((s) => s.appState);
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    rerenderEmbeds = force;
    return () => {
      rerenderEmbeds = () => {};
    };
  }, []);

  const view = getViewportBounds(as);
  const embeds = elements.filter(
    (e): e is EmbeddableElement => e.type === "embeddable" && !e.isDeleted && boundsIntersect(getElementBounds(e), view),
  );
  if (!embeds.length) return null;
  return (
    <div className="embeds-layer" style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 5, overflow: "hidden" }}>
      {embeds.map((el) => {
        const html = typeof el.customData?.html === "string" ? (el.customData.html as string) : null;
        const info = html ? null : el.link ? toEmbedUrl(el.link) : null;
        if (!html && !info) return null;
        const active = session.activeEmbedId === el.id;
        const selected = !!as.selectedElementIds[el.id];
        const cx = (el.x + el.width / 2 + as.scrollX) * as.zoom;
        const cy = (el.y + el.height / 2 + as.scrollY) * as.zoom;
        return (
          <div
            key={el.id}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: el.width,
              height: el.height,
              transformOrigin: "center center",
              transform: `translate(${cx - el.width / 2}px, ${cy - el.height / 2}px) rotate(${el.angle}rad) scale(${as.zoom})`,
              borderRadius: 8,
              overflow: "hidden",
              opacity: el.opacity / 100,
              boxShadow: active ? "0 0 0 2px var(--color-primary)" : undefined,
              pointerEvents: active ? "auto" : "none",
              background: "#fff",
            }}
          >
            <iframe
              title={html ? "Generated page" : el.link ?? "Embedded content"}
              src={html ? undefined : info!.src}
              srcDoc={html ?? info!.srcdoc}
              sandbox={html ? "allow-scripts allow-forms allow-modals" : "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation"}
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              style={{ width: "100%", height: "100%", border: 0, display: "block", pointerEvents: active ? "auto" : "none" }}
            />
            {selected && !active && !as.viewModeEnabled && (
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: 10,
                  transform: `translateX(-50%) scale(${1 / as.zoom})`,
                  transformOrigin: "bottom center",
                  background: "rgba(30,30,30,0.78)",
                  color: "#fff",
                  font: "600 12px var(--ui-font)",
                  padding: "5px 10px",
                  borderRadius: 999,
                  whiteSpace: "nowrap",
                }}
              >
                Double-click to interact
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
