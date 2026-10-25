import { useEffect, useMemo, useState } from "react";
import { showToast } from "../core/store";
import { CheckIcon, ExternalIcon, PlusIcon, SearchIcon } from "../io/icons";
import { parseLibrary } from "./format";
import { addLibraryItems, useLibrary } from "./store";

interface PublicLibrary {
  id?: string;
  name: string;
  description?: string;
  authors?: { name: string; url?: string }[];
  source: string;
  preview?: string;
  created?: string;
  updated?: string;
  itemNames?: string[];
}

const ORIGIN = "https://libraries.excalidraw.com";
const PAGE = 24;

let listCache: Promise<PublicLibrary[]> | null = null;
const loadList = () => {
  if (!listCache) {
    listCache = fetch("/api/libraries")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: unknown) => (Array.isArray(data) ? (data as PublicLibrary[]).filter((l) => l && typeof l.source === "string" && typeof l.name === "string") : []))
      .then((libs) => libs.sort((a, b) => (b.updated ?? b.created ?? "").localeCompare(a.updated ?? a.created ?? "")));
    listCache.catch(() => (listCache = null));
  }
  return listCache;
};

const added = new Set<string>(); // sources added this session

export function BrowseLibraries() {
  const [libs, setLibs] = useState<PublicLibrary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [, force] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    loadList()
      .then((l) => alive && setLibs(l))
      .catch(() => alive && setError("Couldn't load community libraries. Check your connection and try again."));
    return () => {
      alive = false;
    };
  }, [attempt]);

  const filtered = useMemo(() => {
    if (!libs) return [];
    const q = query.trim().toLowerCase();
    if (!q) return libs;
    return libs.filter((l) =>
      [l.name, l.description ?? "", ...(l.authors ?? []).map((a) => a.name), ...(l.itemNames ?? [])].some((s) => s.toLowerCase().includes(q)),
    );
  }, [libs, query]);

  const add = async (lib: PublicLibrary) => {
    if (busy) return;
    setBusy(lib.source);
    try {
      const res = await fetch(`/api/libraries/file?path=${encodeURIComponent(lib.source)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = parseLibrary(await res.text());
      const n = await addLibraryItems(items.map((i) => ({ ...i, status: "published" as const })));
      added.add(lib.source);
      force((x) => x + 1);
      showToast(n ? `Added ${n} item${n === 1 ? "" : "s"} from “${lib.name}”` : `“${lib.name}” is already in your library`, n ? "success" : "info");
    } catch (e) {
      console.error(e);
      showToast(`Couldn't add “${lib.name}”.`, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="io-library__body">
      <div className="io-library__toolbar">
        <div className="io-search">
          <SearchIcon />
          <input
            placeholder="Search libraries"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            aria-label="Search public libraries"
          />
        </div>
        <a className="io-icon-btn" href={ORIGIN} target="_blank" rel="noopener noreferrer" title="Open libraries.excalidraw.com" aria-label="Open libraries website">
          <ExternalIcon />
        </a>
      </div>
      <div className="io-library__scroll">
        {error && (
          <div className="io-library__empty">
            <p>{error}</p>
            <button className="io-btn" onClick={() => setAttempt((a) => a + 1)}>
              Retry
            </button>
          </div>
        )}
        {!libs && !error && (
          <div className="io-library__loading">
            <span className="io-spinner io-spinner--muted" /> Loading libraries…
          </div>
        )}
        {libs && !filtered.length && <p className="io-library__hint">No libraries match “{query}”.</p>}
        <div className="io-browse">
          {filtered.slice(0, limit).map((lib) => {
            const isAdded = added.has(lib.source);
            return (
              <article key={lib.source} className="io-browse__card">
                {lib.preview && (
                  <div className="io-browse__preview">
                    <img src={`${ORIGIN}/libraries/${lib.preview}`} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                  </div>
                )}
                <div className="io-browse__meta">
                  <h3 className="io-browse__name">{lib.name}</h3>
                  {!!lib.authors?.length && <div className="io-browse__author">by {lib.authors.map((a) => a.name).join(", ")}</div>}
                  {lib.description && <p className="io-browse__desc">{lib.description}</p>}
                </div>
                <button
                  className={`io-btn io-btn--small ${isAdded ? "" : "io-btn--primary"}`}
                  onClick={() => void add(lib)}
                  disabled={busy === lib.source}
                  aria-busy={busy === lib.source}
                >
                  {busy === lib.source ? <span className="io-spinner" /> : isAdded ? <CheckIcon /> : <PlusIcon />}
                  {isAdded ? "Added" : "Add to library"}
                </button>
              </article>
            );
          })}
        </div>
        {filtered.length > limit && (
          <button className="io-btn io-library__more" onClick={() => setLimit((l) => l + PAGE)}>
            Show more ({filtered.length - limit})
          </button>
        )}
        {libs && (
          <p className="io-library__hint">
            Community libraries from{" "}
            <a href={ORIGIN} target="_blank" rel="noopener noreferrer">
              libraries.excalidraw.com
            </a>
            . <button className="io-link" onClick={() => useLibrary.setState({ tab: "mine" })}>Back to your library</button>
          </p>
        )}
      </div>
    </div>
  );
}
