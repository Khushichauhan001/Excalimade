# Excalimade

A hand-drawn whiteboard in the style of excalidraw.com, with nested scenes, presentation mode, encrypted share links, live collaboration and AI diagram generation.

## Architecture

| Part | Where it runs | What it does |
|---|---|---|
| Web app (`src/`) | Vercel (static) | React 19 + TypeScript + Vite. Custom canvas engine (roughjs, perfect-freehand), zustand state. |
| API (`api/index.ts` → `server/*`) | Vercel serverless function | `/api/ai/*` (Anthropic, server-side key), `/api/share` (encrypted share links), `/api/libraries` (community library proxy). |
| Realtime relay (`server/index.ts`, `server/collab.ts`) | Render (WebSockets) | Relays **encrypted** collaboration messages between browsers and stores encrypted room snapshots. Vercel can't hold WebSocket connections, so this runs separately. |
| Storage (`server/storage.ts`) | Vercel Blob | Ciphertext only: share links (`shares/<id>.bin`) and room snapshots (`rooms/<id>.bin`). Local disk in development. |

Key modules:

- `src/workspace/`: scene tree (folders and scenes, nestable to any depth). Pure tree operations live in `tree.ts`, the persistence interface (`WorkspaceRepository`, IndexedDB implementation) in `repo.ts`, and state and actions in `store.ts`.
- `src/io/autosave.ts`: per-scene autosave to IndexedDB (gzip'd JSON, images deduplicated in a shared store), debounced at 500 ms.
- `src/collab/`: end-to-end encrypted live collaboration (AES-GCM; the key stays in the `#room=` fragment), reconciliation by `version`/`versionNonce`, cursors, follow mode and voice/screen share (`rtc.ts`), plus read-only share links (`share.ts`).
- `src/io/presentation.ts`, `SlidesPanel.tsx`, `PresenterControls.tsx`: frames become slides.
- `src/diagram/`: Mermaid → editable elements (own parser + dagre layout), charts from CSV, and the AI dialogs.
- `server/ai.ts`: Anthropic Messages API via `fetch`, with per-IP rate limiting and size caps.

The browser never sends plaintext to the server: share links and room data are compressed and encrypted client-side, and the key lives only in the URL fragment (`#json=<id>,<key>`, `#room=<id>,<key>`), which browsers never send to servers.

## Local development

```bash
npm install
cp .env.example .env     # optional: add ANTHROPIC_API_KEY for the AI features
npm run dev              # web on http://localhost:5173, API + relay on :3001 (proxied)
npm test                 # encryption, scene tree and reconciliation tests
npm run build            # production build into dist/
```

Without `BLOB_READ_WRITE_TOKEN`, share links and room snapshots are stored under `server/data/`.

## Production deployment

### 1. Vercel Blob (storage)
1. Vercel dashboard → your project → **Storage** → **Create** → **Blob**. Connect it to the project. This adds `BLOB_READ_WRITE_TOKEN` to the project's environment automatically.
2. Copy the token value (Storage → your store → `.env.local` tab); the Render relay needs it too.

### 2. Render (realtime relay)
1. render.com → **New** → **Blueprint** → pick this GitHub repo. `render.yaml` creates the `excalimade-relay` web service (free plan).
   - Or create it manually with **New → Web Service**, using build command `npm ci --omit=dev`, start command `npx tsx server/index.ts` and health check path `/health`.
2. Environment variables on Render:
   - `BLOB_READ_WRITE_TOKEN`: the value from step 1, so rooms persist across restarts.
   - `ALLOWED_ORIGINS`: `https://excalimade.vercel.app` (comma-separate extra domains).
   - `NODE_VERSION`: `24`
3. After the deploy, note the URL, e.g. `https://excalimade-relay.onrender.com`.

On the free plan the relay sleeps after 15 minutes idle. The first person to start or join a session then sees "Connecting…" for about 30 seconds while it wakes.

### 3. Vercel (web app + API)
Project → Settings → **Environment Variables** (Production and Preview):

| Variable | Value |
|---|---|
| `VITE_WS_URL` | `wss://excalimade-relay.onrender.com/ws` (your Render URL, `wss://`, ending in `/ws`) |
| `ANTHROPIC_API_KEY` | your Anthropic key (server-side only, never sent to the browser) |
| `ANTHROPIC_MODEL` | optional model override |
| `BLOB_READ_WRITE_TOKEN` | added automatically by step 1 |

Settings → General: Framework preset **Vite**, Node.js **22.x or newer**. `vercel.json` already sets the build command, output folder, the `/api/*` rewrite and the function timeout.

**Redeploy** after changing variables: `VITE_*` values are baked into the build.

### Limits
- Share links: 4 MB after compression and encryption (Vercel's request limit is 4.5 MB). Images are already downscaled to WebP on insert, so typical scenes are far smaller.
- AI: 30 text-to-diagram and 10 wireframe-to-code requests per IP per day (`AI_DAILY_LIMIT_*`), prompts up to 2,000 characters.
