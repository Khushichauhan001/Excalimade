import { useEffect, useMemo, useRef, useState } from "react";
import type { LibraryItem } from "../core/types";
import { useStore, getSelectedElements, showToast } from "../core/store";
import { useDevice } from "../core/useDevice";
import { confirmDialog } from "../io/Dialog";
import { saveBlob } from "../io/fileio";
import { EXCALIDRAW_LIB_MIME } from "../io/encode";
import { CheckIcon, CloseIcon, DownloadIcon, LibraryIcon, MoreIcon, PlusIcon, ResetIcon, SearchIcon, TrashIcon, UploadIcon } from "../io/icons";
import {
  LIBRARY_DRAG_MIME,
  addElementsToLibrary,
  insertLibraryItems,
  loadLibrary,
  removeLibraryItems,
  resetLibrary,
  useLibrary,
} from "./store";
import { serializeLibrary } from "./format";
import { dropThumbnails, getThumbnail } from "./thumbnails";
import { importLibraryFromDisk } from "./actions";
import { BrowseLibraries } from "./BrowseLibraries";
import "./library.css";

export function LibrarySidebar() {
  const { isMobile } = useDevice();
  const tab = useLibrary((s) => s.tab);
  const close = () => useStore.getState().setAppState({ openSidebar: null });

  useEffect(() => {
    void loadLibrary();
  }, []);

  return (
    <aside
      className={`io-library ${isMobile ? "io-library--sheet" : ""}`}
      aria-label="Library"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      {isMobile && <div className="io-library__grabber" aria-hidden="true" />}
      <header className="io-library__header">
        <div className="io-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "mine"} className={tab === "mine" ? "is-active" : ""} onClick={() => useLibrary.setState({ tab: "mine" })}>
            Library
          </button>
          <button role="tab" aria-selected={tab === "browse"} className={tab === "browse" ? "is-active" : ""} onClick={() => useLibrary.setState({ tab: "browse" })}>
            Browse libraries
          </button>
        </div>
        <button className="io-icon-btn" onClick={close} aria-label="Close library" title="Close">
          <CloseIcon />
        </button>
      </header>
      {tab === "mine" ? <PersonalLibrary isMobile={isMobile} /> : <BrowseLibraries />}
    </aside>
  );
}

function PersonalLibrary({ isMobile }: { isMobile: boolean }) {
  const items = useLibrary((s) => s.items);
  const loaded = useLibrary((s) => s.loaded);
  const theme = useStore((s) => s.appState.theme);
  const canvasHasSelection = useStore((s) => Object.keys(s.appState.selectedElementIds).length > 0);
  const viewMode = useStore((s) => s.appState.viewModeEnabled);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // forget selections of items that no longer exist
  useEffect(() => {
    setSelected((sel) => {
      const ids = new Set(items.map((i) => i.id));
      const next = new Set([...sel].filter((id) => ids.has(id)));
      return next.size === sel.size ? sel : next;
    });
  }, [items]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [menuOpen]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.name.toLowerCase().includes(q) || i.elements.some((e) => e.type === "text" && (e as { text: string }).text.toLowerCase().includes(q))) : items;
  }, [items, query]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selectedItems = items.filter((i) => selected.has(i.id));

  const insert = (list: LibraryItem[]) => {
    if (viewMode) return showToast("Can't add items in view mode.", "info");
    insertLibraryItems(list);
    if (isMobile) useStore.getState().setAppState({ openSidebar: null });
  };

  const exportItems = async (list: LibraryItem[]) => {
    setMenuOpen(false);
    if (!list.length) return;
    const blob = new Blob([serializeLibrary(list)], { type: EXCALIDRAW_LIB_MIME });
    const r = await saveBlob(blob, { name: "library", extension: ".excalidrawlib", mimeType: EXCALIDRAW_LIB_MIME, description: "Excalidraw library" });
    if (r !== "cancelled") showToast(`Exported ${list.length} item${list.length === 1 ? "" : "s"}`, "success");
  };

  const remove = async (ids: Set<string>) => {
    const ok = await confirmDialog({
      title: "Remove items?",
      message: `Remove ${ids.size} item${ids.size === 1 ? "" : "s"} from your library?`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    removeLibraryItems(ids);
    dropThumbnails(ids);
    setSelected(new Set());
  };

  const reset = async () => {
    setMenuOpen(false);
    const ok = await confirmDialog({
      title: "Reset library",
      message: "This will remove every item from your library. This can't be undone.",
      confirmLabel: "Reset library",
      danger: true,
    });
    if (!ok) return;
    dropThumbnails(items.map((i) => i.id));
    resetLibrary();
    setSelected(new Set());
  };

  return (
    <div className="io-library__body">
      <div className="io-library__toolbar">
        <div className="io-search">
          <SearchIcon />
          <input placeholder="Search library" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search library" />
        </div>
        <div className="io-menu" ref={menuRef}>
          <button className="io-icon-btn" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)} title="Library options">
            <MoreIcon />
          </button>
          {menuOpen && (
            <div className="io-menu__popover" role="menu">
              <button role="menuitem" onClick={() => (setMenuOpen(false), void importLibraryFromDisk())}>
                <UploadIcon /> Import from file…
              </button>
              <button role="menuitem" disabled={!items.length} onClick={() => void exportItems(selectedItems.length ? selectedItems : items)}>
                <DownloadIcon /> {selectedItems.length ? `Export selected (${selectedItems.length})` : "Export library"}
              </button>
              <button role="menuitem" disabled={!items.length} onClick={() => (setSelected(new Set(items.map((i) => i.id))), setMenuOpen(false))}>
                <CheckIcon /> Select all
              </button>
              <button role="menuitem" className="io-menu__danger" disabled={!items.length} onClick={() => void reset()}>
                <ResetIcon /> Reset library
              </button>
            </div>
          )}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="io-library__selbar">
          <span>{selected.size} selected</span>
          <div className="io-library__selbar-actions">
            <button className="io-btn io-btn--small" onClick={() => insert(selectedItems)} title="Insert selected items onto the canvas">
              <PlusIcon /> Insert
            </button>
            <button className="io-btn io-btn--small" onClick={() => void exportItems(selectedItems)} title="Publish: export as .excalidrawlib">
              <DownloadIcon /> Export
            </button>
            <button className="io-icon-btn io-icon-btn--danger" onClick={() => void remove(selected)} title="Remove selected" aria-label="Remove selected">
              <TrashIcon />
            </button>
            <button className="io-icon-btn" onClick={() => setSelected(new Set())} title="Clear selection" aria-label="Clear selection">
              <CloseIcon />
            </button>
          </div>
        </div>
      )}

      <div className="io-library__scroll">
        <div className="io-library__grid">
          {canvasHasSelection && !query && (
            <button
              className="io-library__cell io-library__add"
              onClick={() => void addElementsToLibrary(getSelectedElements())}
              title="Add selected elements to the library"
            >
              <PlusIcon />
              <span>Add to library</span>
            </button>
          )}
          {visible.map((item) => (
            <LibraryCell
              key={item.id}
              item={item}
              dark={theme === "dark"}
              selected={selected.has(item.id)}
              selecting={selected.size > 0}
              onToggle={() => toggle(item.id)}
              onInsert={() => insert([item])}
              dragIds={selected.has(item.id) ? [...selected] : [item.id]}
            />
          ))}
        </div>
        {loaded && !items.length && (
          <div className="io-library__empty">
            <LibraryIcon />
            <strong>No items added yet</strong>
            <p>Select elements on the canvas and choose “Add to library”, or browse community libraries.</p>
            <button className="io-btn io-btn--primary" onClick={() => useLibrary.setState({ tab: "browse" })}>
              Browse libraries
            </button>
          </div>
        )}
        {items.length > 0 && !visible.length && <p className="io-library__hint">No items match “{query}”.</p>}
        {items.length > 0 && (
          <p className="io-library__hint">Click to insert · drag onto the canvas · Shift-click to select several</p>
        )}
      </div>
    </div>
  );
}

function LibraryCell(props: {
  item: LibraryItem;
  dark: boolean;
  selected: boolean;
  selecting: boolean;
  onToggle: () => void;
  onInsert: () => void;
  dragIds: string[];
}) {
  const { item, dark } = props;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // render the thumbnail once the cell scrolls into view
  useEffect(() => {
    let alive = true;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void getThumbnail(item, dark).then((u) => {
        if (!alive) return;
        setUrl(u);
        setFailed(!u);
      });
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [item, dark]);

  return (
    <div
      ref={ref}
      className={`io-library__cell ${props.selected ? "is-selected" : ""}`}
      role="button"
      tabIndex={0}
      title={item.name || "Library item"}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(LIBRARY_DRAG_MIME, JSON.stringify(props.dragIds));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={(e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey || props.selecting) props.onToggle();
        else props.onInsert();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onInsert();
        }
      }}
    >
      {url ? (
        <img src={url} alt={item.name || "Library item"} draggable={false} />
      ) : failed ? (
        <span className="io-library__fallback">{item.name || `${item.elements.length} element${item.elements.length === 1 ? "" : "s"}`}</span>
      ) : (
        <span className="io-spinner io-spinner--muted" />
      )}
      <button
        className="io-library__check"
        aria-label={props.selected ? "Deselect item" : "Select item"}
        aria-pressed={props.selected}
        onClick={(e) => {
          e.stopPropagation();
          props.onToggle();
        }}
      >
        {props.selected && <CheckIcon />}
      </button>
    </div>
  );
}
