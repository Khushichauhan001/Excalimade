import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import "./workspace.css";
import { useStore, showToast } from "../core/store";
import { useDevice } from "../core/useDevice";
import { Dialog } from "../ui/components/Dialog";
import { Button } from "../ui/components/Button";
import { byId, canMove, childrenOf, pathTo, visibleRows, type TreeNode } from "./tree";
import {
  createFolder,
  createScene,
  deleteTreeNode,
  duplicateTreeNode,
  exportWorkspace,
  importWorkspace,
  initWorkspace,
  moveTreeNode,
  openScene,
  renameNodeTitle,
  setSidebarOpen,
  toggleExpanded,
  useWorkspace,
} from "./store";

const Icon = {
  folder: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M2.5 5.5a1 1 0 011-1h4l1.5 2h7.5a1 1 0 011 1v7a1 1 0 01-1 1h-13a1 1 0 01-1-1z" /></svg>,
  scene: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><rect x="3" y="3.5" width="14" height="13" rx="2" /><path d="M6 12.5l2.5-3 2 2 1.5-1.5 2 2.5" /></svg>,
  caret: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 6l4 4-4 4" /></svg>,
  plusScene: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="3.5" width="14" height="13" rx="2" /><path d="M10 7.5v5M7.5 10h5" /></svg>,
  plusFolder: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 5.5a1 1 0 011-1h4l1.5 2h7.5a1 1 0 011 1v7a1 1 0 01-1 1h-13a1 1 0 01-1-1z" /><path d="M10 9v4M8 11h4" /></svg>,
  more: <svg viewBox="0 0 20 20" fill="currentColor"><circle cx="5" cy="10" r="1.4" /><circle cx="10" cy="10" r="1.4" /><circle cx="15" cy="10" r="1.4" /></svg>,
  sidebar: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="3.5" width="15" height="13" rx="2" /><path d="M7.5 3.5v13" /></svg>,
  close: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>,
};

type DropPos = "before" | "after" | "inside";

function RenameInput({ node }: { node: TreeNode }) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    if (value !== null && value.trim() && value.trim() !== node.title) renameNodeTitle(node.id, value);
    else useWorkspace.setState({ renamingId: null });
  };
  return (
    <input
      className="ws-rename"
      autoFocus
      defaultValue={node.title}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        if (e.key === "Escape") finish(null);
      }}
    />
  );
}

function RowMenu({ node, onClose, onDelete }: { node: TreeNode; onClose(): void; onDelete(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener("pointerdown", off, true);
    return () => window.removeEventListener("pointerdown", off, true);
  }, [onClose]);
  const item = (label: string, fn: () => void, danger = false) => (
    <button className={`ws-menu__item ${danger ? "is-danger" : ""}`} onClick={() => (onClose(), fn())}>
      {label}
    </button>
  );
  return (
    <div className="ws-menu" ref={ref} role="menu">
      {item(node.type === "folder" ? "New scene in folder" : "New child scene", () => void createScene(node.id))}
      {item("New folder inside", () => createFolder(node.id))}
      {item("Rename  (F2)", () => useWorkspace.setState({ renamingId: node.id }))}
      {item("Duplicate", () => void duplicateTreeNode(node.id))}
      {item("Move to top level", () => moveTreeNode(node.id, null))}
      {item("Delete…", onDelete, true)}
    </div>
  );
}

function ConfirmDelete({ node, onClose }: { node: TreeNode; onClose(): void }) {
  const nodes = useWorkspace((s) => s.nodes);
  const count = useMemo(() => {
    let n = 0;
    const walk = (id: string) => childrenOf(nodes, id).forEach((c) => (n++, walk(c.id)));
    walk(node.id);
    return n;
  }, [nodes, node.id]);
  return (
    <Dialog
      title={`Delete “${node.title}”?`}
      size="small"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={() => (onClose(), void deleteTreeNode(node.id))}>Delete</Button>
        </>
      }
    >
      <p>
        {count ? `This also deletes everything inside it (${count} item${count === 1 ? "" : "s"}). ` : ""}
        This can't be undone — export the workspace first if you want a backup.
      </p>
    </Dialog>
  );
}

function Sidebar() {
  const { nodes, activeId, expanded, renamingId } = useWorkspace();
  const device = useDevice();
  const [filter, setFilter] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<TreeNode | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: string | null; pos: DropPos | null } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rows = visibleRows(nodes, expanded, filter);
  const sceneCount = nodes.filter((n) => n.type === "scene").length;

  const open = (n: TreeNode) => {
    if (n.type === "folder") toggleExpanded(n.id);
    else {
      void openScene(n.id);
      if (device.isMobile) setSidebarOpen(false);
    }
  };

  const onDragOver = (e: DragEvent, n: TreeNode) => {
    if (!drag) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const pos: DropPos = y < 0.28 ? "before" : y > 0.72 ? "after" : "inside";
    const parent = pos === "inside" ? n.id : n.parentId;
    const ok = drag.id !== n.id && canMove(nodes, drag.id, parent);
    e.dataTransfer.dropEffect = ok ? "move" : "none";
    if (drag.over !== n.id || drag.pos !== pos) setDrag({ ...drag, over: ok ? n.id : null, pos: ok ? pos : null });
  };
  const onDrop = (e: DragEvent, n: TreeNode) => {
    e.preventDefault();
    if (!drag?.pos || drag.over !== n.id) return setDrag(null);
    if (drag.pos === "inside") moveTreeNode(drag.id, n.id);
    else if (drag.pos === "before") moveTreeNode(drag.id, n.parentId, n.id);
    else {
      const sib = childrenOf(nodes, n.parentId).filter((s) => s.id !== drag.id);
      const next = sib[sib.findIndex((s) => s.id === n.id) + 1];
      moveTreeNode(drag.id, n.parentId, next?.id ?? null);
    }
    setDrag(null);
  };

  const onKey = (e: KeyboardEvent, n: TreeNode) => {
    if (renamingId) return;
    const i = rows.findIndex((r) => r.node.id === n.id);
    if (e.key === "F2") (e.preventDefault(), useWorkspace.setState({ renamingId: n.id }));
    else if (e.key === "Delete" || e.key === "Backspace") (e.preventDefault(), setConfirm(n));
    else if (e.key === "Enter") open(n);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = rows[i + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) (document.querySelector(`[data-node="${next.node.id}"]`) as HTMLElement | null)?.focus();
    } else if (e.key === "ArrowRight" && n.type === "folder") toggleExpanded(n.id, true);
    else if (e.key === "ArrowLeft" && expanded.has(n.id)) toggleExpanded(n.id, false);
    e.stopPropagation();
  };

  return (
    <>
      {device.isMobile && <div className="ws-backdrop" onClick={() => setSidebarOpen(false)} />}
      <aside className="ws-sidebar" aria-label="Scenes" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <header className="ws-head">
          <span className="ws-head__title">Scenes <span className="ws-count">{sceneCount}</span></span>
          <button className="ws-icon" title="New scene" aria-label="New scene" onClick={() => void createScene(null)}>{Icon.plusScene}</button>
          <button className="ws-icon" title="New folder" aria-label="New folder" onClick={() => createFolder(null)}>{Icon.plusFolder}</button>
          <div className="ws-more">
            <button className="ws-icon" title="More" aria-label="Workspace options" onClick={() => setMoreOpen(!moreOpen)}>{Icon.more}</button>
            {moreOpen && (
              <div className="ws-menu ws-menu--right" onMouseLeave={() => setMoreOpen(false)}>
                <button className="ws-menu__item" onClick={() => (setMoreOpen(false), void exportWorkspace())}>Export workspace (.json)</button>
                <button className="ws-menu__item" onClick={() => (setMoreOpen(false), fileRef.current?.click())}>Import workspace…</button>
                <button className="ws-menu__item" onClick={() => (setMoreOpen(false), useWorkspace.setState({ expanded: new Set() }))}>Collapse all</button>
              </div>
            )}
          </div>
          <button className="ws-icon" title="Close sidebar" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}>{Icon.close}</button>
        </header>
        <input className="ws-search" placeholder="Search scenes…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="ws-tree" role="tree" onDragEnd={() => setDrag(null)}>
          {rows.map(({ node: n, depth, hasChildren }) => {
            const isOpen = expanded.has(n.id) || !!filter;
            const cls = [
              "ws-row",
              n.id === activeId && "is-active",
              focusId === n.id && "is-focus",
              drag?.over === n.id && `drop-${drag.pos}`,
              drag?.id === n.id && "is-dragging",
            ].filter(Boolean).join(" ");
            return (
              <div
                key={n.id}
                data-node={n.id}
                className={cls}
                role="treeitem"
                aria-selected={n.id === activeId}
                aria-expanded={hasChildren ? isOpen : undefined}
                tabIndex={0}
                style={{ paddingLeft: 8 + depth * 16 }}
                draggable={!renamingId}
                onDragStart={(e) => (e.dataTransfer.setData("text/plain", n.id), (e.dataTransfer.effectAllowed = "move"), setDrag({ id: n.id, over: null, pos: null }))}
                onDragOver={(e) => onDragOver(e, n)}
                onDrop={(e) => onDrop(e, n)}
                onClick={() => open(n)}
                onDoubleClick={(e) => (e.stopPropagation(), useWorkspace.setState({ renamingId: n.id }))}
                onKeyDown={(e) => onKey(e, n)}
                onFocus={() => setFocusId(n.id)}
                onContextMenu={(e) => (e.preventDefault(), setMenuFor(n.id))}
              >
                <span
                  className={`ws-caret ${hasChildren ? "" : "is-empty"} ${isOpen ? "is-open" : ""}`}
                  onClick={(e) => (e.stopPropagation(), hasChildren && toggleExpanded(n.id))}
                >
                  {hasChildren && Icon.caret}
                </span>
                <span className="ws-type">{n.type === "folder" ? Icon.folder : Icon.scene}</span>
                {renamingId === n.id ? <RenameInput node={n} /> : <span className="ws-title" title={n.title}>{n.title}</span>}
                <button className="ws-icon ws-row__more" aria-label={`Options for ${n.title}`} onClick={(e) => (e.stopPropagation(), setMenuFor(menuFor === n.id ? null : n.id))}>
                  {Icon.more}
                </button>
                {menuFor === n.id && <RowMenu node={n} onClose={() => setMenuFor(null)} onDelete={() => setConfirm(n)} />}
              </div>
            );
          })}
          {!rows.length && <div className="ws-empty">{filter ? "No scenes match your search" : "No scenes yet"}</div>}
          {/* dropping here moves the dragged item to the top level */}
          <div
            className={`ws-rootdrop ${drag ? "is-visible" : ""}`}
            onDragOver={(e) => drag && (e.preventDefault(), setDrag({ ...drag, over: null, pos: null }))}
            onDrop={(e) => (e.preventDefault(), drag && moveTreeNode(drag.id, null), setDrag(null))}
          >
            Drop here to move to the top level
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              await importWorkspace(await f.text());
            } catch (err) {
              showToast((err as Error).message, "error");
            }
          }}
        />
      </aside>
      {confirm && <ConfirmDelete node={confirm} onClose={() => setConfirm(null)} />}
    </>
  );
}

function Breadcrumb() {
  const { nodes, activeId, sidebarOpen } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const path = activeId ? pathTo(nodes, activeId) : [];
  const active = byId(nodes, activeId);
  if (!active) return null;
  return (
    <div className="ws-crumbs" onPointerDown={(e) => e.stopPropagation()}>
      {!sidebarOpen && (
        <button className="ws-icon ws-crumbs__toggle" title="Show scenes" aria-label="Show scenes sidebar" onClick={() => setSidebarOpen(true)}>
          {Icon.sidebar}
        </button>
      )}
      {path.slice(0, -1).map((p) => (
        <span key={p.id} className="ws-crumb">
          <button className="ws-crumb__btn" onClick={() => (setSidebarOpen(true), toggleExpanded(p.id, true))}>{p.title}</button>
          <span className="ws-crumb__sep">/</span>
        </span>
      ))}
      {editing ? (
        <span className="ws-crumb ws-crumb--edit">
          <input
            className="ws-rename"
            autoFocus
            defaultValue={active.title}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => (renameNodeTitle(active.id, e.currentTarget.value), setEditing(false))}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        </span>
      ) : (
        <button className="ws-crumb__btn ws-crumb__btn--active" title="Rename scene" onClick={() => setEditing(true)}>
          {active.title}
        </button>
      )}
    </div>
  );
}

export function WorkspaceLayer() {
  const ready = useWorkspace((s) => s.ready);
  const sidebarOpen = useWorkspace((s) => s.sidebarOpen);
  const hidden = useStore((s) => !!s.appState.presentationMode || s.appState.zenModeEnabled || (s.appState.viewModeEnabled && /^#json=/.test(location.hash)));
  const isRoom = /^#room=/.test(typeof location !== "undefined" ? location.hash : "");
  useEffect(() => void initWorkspace(), []);
  useEffect(() => {
    document.documentElement.classList.toggle("has-scenes", ready && sidebarOpen && !hidden && !isRoom);
  }, [ready, sidebarOpen, hidden, isRoom]);
  if (!ready || hidden || isRoom) return null;
  return (
    <>
      {sidebarOpen && <Sidebar />}
      <Breadcrumb />
    </>
  );
}
