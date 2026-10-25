// AI endpoints: text → Mermaid diagram, wireframe image → self-contained HTML.
// Calls the Claude Messages API with plain fetch (no SDK). Key from ANTHROPIC_API_KEY (.env supported).
import type http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { readJson, sendJson, type ApiHandler } from "./http";

// ---- .env (tiny parser; existing environment variables win) ----------------------------------
function loadDotEnv() {
  const candidates = [path.resolve(process.cwd(), ".env"), path.resolve(import.meta.dirname, "../.env")];
  for (const file of new Set(candidates)) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const raw of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
      if (!m || raw.trim().startsWith("#")) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      else v = v.replace(/\s+#.*$/, "");
      if (process.env[m[1]] === undefined) process.env[m[1]] = v.replace(/\\n/g, "\n");
    }
  }
}
loadDotEnv();

// ---- config -------------------------------------------------------------------------------------
const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const SETUP = "Set ANTHROPIC_API_KEY in .env and restart the server";

type Kind = "text-to-diagram" | "wireframe-to-code";
const LIMITS: Record<Kind, number> = {
  "text-to-diagram": Number(process.env.AI_DAILY_LIMIT_TEXT ?? 30),
  "wireframe-to-code": Number(process.env.AI_DAILY_LIMIT_WIREFRAME ?? 10),
};
const TIMEOUT: Record<Kind, number> = { "text-to-diagram": 120_000, "wireframe-to-code": 240_000 };
const MAX_IN_FLIGHT_PER_IP = 2;

// ---- per-IP daily rate limit (in memory) ----------------------------------------------------------
interface Usage {
  day: string;
  counts: Record<Kind, number>;
  inFlight: number;
}
const usage = new Map<string, Usage>();
const today = () => new Date().toISOString().slice(0, 10);

function clientIp(req: http.IncomingMessage) {
  if (process.env.TRUST_PROXY) {
    const fwd = req.headers["x-forwarded-for"];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function getUsage(ip: string): Usage {
  const d = today();
  let u = usage.get(ip);
  if (!u || u.day !== d) {
    u = { day: d, counts: { "text-to-diagram": 0, "wireframe-to-code": 0 }, inFlight: u?.inFlight ?? 0 };
    usage.set(ip, u);
  }
  // keep the map bounded: drop stale days
  if (usage.size > 10_000) for (const [k, v] of usage) if (v.day !== d && !v.inFlight) usage.delete(k);
  return u;
}

const remaining = (u: Usage, kind: Kind) => Math.max(0, LIMITS[kind] - u.counts[kind]);

function setRateHeaders(res: http.ServerResponse, u: Usage, kind: Kind) {
  res.setHeader("X-RateLimit-Limit", String(LIMITS[kind]));
  res.setHeader("X-RateLimit-Remaining", String(remaining(u, kind)));
}

// ---- Claude Messages API ----------------------------------------------------------------------------
class UpstreamError extends Error {
  status: number;
  /** true when the failure wasn't the user's doing (refund the quota) */
  refund: boolean;
  constructor(message: string, status: number, refund: boolean) {
    super(message);
    this.status = status;
    this.refund = refund;
  }
}

interface ContentBlock {
  type: string;
  text?: string;
}

async function callClaude(opts: {
  system: string;
  content: unknown[];
  maxTokens: number;
  effort: "low" | "medium" | "high";
  signal: AbortSignal;
}): Promise<{ text: string; stopReason: string }> {
  const key = process.env.ANTHROPIC_API_KEY!;
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2026-10-21",
        // server-side refusal fallback (routes a declined request to Anthropic's recommended model)
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: opts.maxTokens,
        fallbacks: "default",
        output_config: { effort: opts.effort },
        system: opts.system,
        messages: [{ role: "user", content: opts.content }],
      }),
      signal: opts.signal,
    });
  } catch (err) {
    const aborted = (err as Error).name === "TimeoutError" || (err as Error).name === "AbortError";
    throw new UpstreamError(aborted ? "The AI service took too long to respond. Please try again." : "Could not reach the AI service.", 504, true);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j.error?.message ?? "";
    } catch {
      /* non-JSON error body */
    }
    console.error(`[ai] upstream ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    if (res.status === 401 || res.status === 403)
      throw new UpstreamError("The AI service rejected the configured API key. Check ANTHROPIC_API_KEY.", 502, true);
    if (res.status === 429 || res.status === 529) throw new UpstreamError("The AI service is busy right now. Please try again in a minute.", 503, true);
    if (res.status === 413) throw new UpstreamError("The request is too large for the AI service.", 413, true);
    throw new UpstreamError("The AI service returned an error. Please try again.", 502, true);
  }
  const json = (await res.json()) as { content?: ContentBlock[]; stop_reason?: string };
  if (json.stop_reason === "refusal") throw new UpstreamError("The AI declined this request. Try rephrasing it.", 422, false);
  const text = (json.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return { text, stopReason: json.stop_reason ?? "" };
}

// ---- output cleanup / validation ---------------------------------------------------------------------
const MERMAID_TYPES = /^(flowchart|graph|sequenceDiagram|classDiagram(-v2)?|erDiagram|stateDiagram(-v2)?|pie)\b/;

export function extractMermaid(raw: string): string | null {
  let t = raw.trim();
  const fence = /```(?:mermaid)?[^\n]*\n([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1];
  t = t.replace(/^\s*%%\{[\s\S]*?\}%%\s*$/gm, "");
  const lines = t.split("\n");
  const start = lines.findIndex((l) => MERMAID_TYPES.test(l.trim()));
  if (start < 0) return null;
  const out = lines.slice(start).join("\n").replace(/```\s*$/, "").trimEnd();
  return out.length ? out : null;
}

export function extractHtml(raw: string): string | null {
  let t = raw.trim();
  const fence = /```(?:html)?[^\n]*\n([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.search(/<!doctype html|<html[\s>]/i);
  if (start < 0) return null;
  const endIdx = t.toLowerCase().lastIndexOf("</html>");
  return endIdx > start ? t.slice(start, endIdx + 7) : t.slice(start);
}

// ---- prompts -------------------------------------------------------------------------------------------
const DIAGRAM_SYSTEM = `You turn a user's description into a Mermaid diagram that is converted into a hand-drawn Excalidraw drawing.

Reply with Mermaid source only: no prose, no explanations, no code fences.

Supported diagram types (choose the one that fits the request best; default to flowchart):
- flowchart (TD or LR). Node shapes: [rect], (rounded), ([stadium]), [[subroutine]], [(database)], ((circle)), {decision}, {{hexagon}}, [/parallelogram/]. Edges: -->, ---, -.->, ==>, -->|label|. subgraph id [Title] ... end groups related nodes. classDef/class for a few colors.
- sequenceDiagram: participant/actor, ->>, -->>, -), -x, Note over/left of/right of, loop/alt/else/opt/par ... end, activate/deactivate.
- classDiagram: classes with members, relations <|--, *--, o--, -->, ..>, ..|> with optional "1"/"*" cardinalities and : labels.
- erDiagram: ENTITY { type name PK } blocks and relations like ||--o{ with : "label".
- stateDiagram-v2: [*] --> State, transitions with : labels, composite states with { }.
- pie: title, then "Label" : value lines.

Rules:
- Keep node labels short (at most ~6 words). Quote labels that contain punctuation, e.g. A["Login (OAuth)"]. Use <br> for line breaks.
- Use simple alphanumeric node ids.
- Aim for a clear diagram of roughly 4 to 25 nodes; group with subgraphs when it helps.
- Do not use %%{init}%% directives, click statements, markdown, or HTML other than <br>.`;

const WIREFRAME_SYSTEM = `You are an expert front-end engineer and UI designer. You receive a low-fidelity, hand-drawn wireframe (an image exported from a whiteboard) and the exact text strings written in it.

Build a polished, working web page that implements the wireframe:
- Reply with ONE complete, self-contained HTML document (starting with <!DOCTYPE html>) and nothing else: no explanations, no code fences.
- All CSS in a <style> tag and all JavaScript in a <script> tag. Do not load anything from the network: no external stylesheets, scripts, fonts or images (use inline SVG, CSS shapes or gradients for imagery and icons).
- Follow the wireframe's layout, hierarchy and proportions; treat annotations and arrows as instructions, not content. Use the provided text strings verbatim where they appear in the UI.
- Make interactive elements work (tabs, toggles, menus, forms with client-side behavior) using plain JavaScript.
- Responsive, accessible (semantic elements, labels, sufficient contrast), modern and clean typography using system fonts.
- The page is shown inside a sandboxed iframe with no same-origin access: do not use localStorage, cookies, alert/confirm/prompt, or top-level navigation.`;

// ---- handlers -----------------------------------------------------------------------------------------
async function guard(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  kind: Kind,
  run: (signal: AbortSignal) => Promise<unknown>,
) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return sendJson(res, 503, { error: "AI features are not configured on this server.", setup: SETUP });
  }
  const ip = clientIp(req);
  const u = getUsage(ip);
  if (remaining(u, kind) <= 0) {
    setRateHeaders(res, u, kind);
    return sendJson(res, 429, {
      error: `Daily limit reached (${LIMITS[kind]} per day). It resets at midnight UTC.`,
      remaining: 0,
      limit: LIMITS[kind],
    });
  }
  if (u.inFlight >= MAX_IN_FLIGHT_PER_IP) {
    setRateHeaders(res, u, kind);
    return sendJson(res, 429, { error: "Please wait for your current request to finish.", remaining: remaining(u, kind), limit: LIMITS[kind] });
  }
  u.counts[kind]++;
  u.inFlight++;
  const ctrl = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) ctrl.abort();
  };
  res.on("close", onClose);
  try {
    const body = await run(AbortSignal.any([ctrl.signal, AbortSignal.timeout(TIMEOUT[kind])]));
    setRateHeaders(res, u, kind);
    sendJson(res, 200, { ...(body as object), remaining: remaining(u, kind), limit: LIMITS[kind] });
  } catch (err) {
    if (err instanceof UpstreamError) {
      if (err.refund) u.counts[kind] = Math.max(0, u.counts[kind] - 1);
      setRateHeaders(res, u, kind);
      if (!res.headersSent && !res.writableEnded) sendJson(res, err.status, { error: err.message, remaining: remaining(u, kind), limit: LIMITS[kind] });
    } else {
      u.counts[kind] = Math.max(0, u.counts[kind] - 1);
      throw err;
    }
  } finally {
    u.inFlight--;
    res.off("close", onClose);
  }
}

async function readBody<T>(req: http.IncomingMessage, limit: number): Promise<T> {
  try {
    return await readJson<T>(req, limit);
  } catch (err) {
    if ((err as { status?: number }).status) throw err;
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export const handleAI: ApiHandler = async (req, res, url) => {
  if (!url.pathname.startsWith("/api/ai/")) return false;
  const route = url.pathname.slice("/api/ai/".length);

  if (route === "status" && req.method === "GET") {
    const u = getUsage(clientIp(req));
    sendJson(res, 200, {
      configured: !!process.env.ANTHROPIC_API_KEY,
      setup: process.env.ANTHROPIC_API_KEY ? undefined : SETUP,
      usage: {
        "text-to-diagram": { remaining: remaining(u, "text-to-diagram"), limit: LIMITS["text-to-diagram"] },
        "wireframe-to-code": { remaining: remaining(u, "wireframe-to-code"), limit: LIMITS["wireframe-to-code"] },
      },
    });
    return true;
  }

  if (route === "text-to-diagram") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST" }), true;
    const body = await readBody<{ prompt?: unknown; previousError?: unknown; previousMermaid?: unknown }>(req, 32 * 1024);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return sendJson(res, 400, { error: "Describe the diagram you want." }), true;
    if (prompt.length > 2000) return sendJson(res, 413, { error: "The description is too long (max 2000 characters)." }), true;
    const previousError = clip(body.previousError, 1000);
    const previousMermaid = clip(body.previousMermaid, 12_000);

    await guard(req, res, "text-to-diagram", async (signal) => {
      let text = `Create a diagram for this description:\n\n<description>\n${prompt}\n</description>`;
      if (previousError) {
        text +=
          `\n\nYour previous attempt could not be parsed.\n<error>\n${previousError}\n</error>` +
          (previousMermaid ? `\n<previous_attempt>\n${previousMermaid}\n</previous_attempt>` : "") +
          `\nReturn a corrected diagram that avoids this error, using only the syntax listed in the instructions.`;
      }
      const out = await callClaude({ system: DIAGRAM_SYSTEM, content: [{ type: "text", text }], maxTokens: 8000, effort: "medium", signal });
      const mermaid = extractMermaid(out.text);
      if (!mermaid) throw new UpstreamError("The AI did not return a diagram. Try describing it differently.", 502, true);
      return { mermaid };
    });
    return true;
  }

  if (route === "wireframe-to-code") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST" }), true;
    const body = await readBody<{ image?: unknown; texts?: unknown; theme?: unknown }>(req, 9 * 1024 * 1024);
    const m = typeof body.image === "string" ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.image) : null;
    if (!m) return sendJson(res, 400, { error: "Expected a PNG, JPEG or WebP data URL in `image`." }), true;
    if (m[2].length > 6.6 * 1024 * 1024) return sendJson(res, 413, { error: "The wireframe image is too large (max 5 MB)." }), true;
    const texts = (Array.isArray(body.texts) ? body.texts : [])
      .filter((t): t is string => typeof t === "string" && !!t.trim())
      .slice(0, 300)
      .map((t) => t.slice(0, 500));
    const theme = body.theme === "dark" ? "dark" : "light";

    await guard(req, res, "wireframe-to-code", async (signal) => {
      const textList = texts.length ? texts.map((t) => `- ${JSON.stringify(t)}`).join("\n") : "(no text was found in the frame)";
      const out = await callClaude({
        system: WIREFRAME_SYSTEM,
        content: [
          { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
          {
            type: "text",
            text: `Text strings found in the wireframe:\n${textList}\n\nPreferred color scheme: ${theme}. Build the page now.`,
          },
        ],
        maxTokens: 32000,
        effort: "medium",
        signal,
      });
      if (out.stopReason === "max_tokens") throw new UpstreamError("The generated page was too long. Try simplifying the wireframe.", 502, true);
      const html = extractHtml(out.text);
      if (!html) throw new UpstreamError("The AI did not return an HTML page. Please try again.", 502, true);
      return { html };
    });
    return true;
  }

  sendJson(res, 404, { error: "Unknown AI endpoint" });
  return true;
};
