// Excalimade+ dashboard (openDialog: "cloud"): workspaces, collections, scene grid, trash, notifications.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getState, getNonDeletedElements, showToast, useStore } from "../core/store";
import { useDevice } from "../core/useDevice";
import { Api, thumbUrl, type Collection, type Notification, type SceneListItem, type Workspace } from "./api";
import { useCloud, setCloud, cloud } from "./session";
import {
  confirmDialog,
  createBlankScene,
  openCloudScene,
  openModal,
  promptDialog,
  saveAsNew,
  signOut,
  toastError,
  updateCurrentMeta,
} from "./controller";
import { AuthScreen } from "./Auth";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { Avatar, ClDialog, Icon, MenuButton, Spinner, timeAgo, type MenuItem } from "./ui";

type View = { kind: "all" } | { kind: "collection"; id: string } | { kind: "trash" };
const WS_KEY = "cl-workspace";
const readWs = () => {
  try {
    return localStorage.getItem(WS_KEY);
  } catch {
    return null;
  }
};
const writeWs = (id: string) => {
  try {
    localStorage.setItem(WS_KEY, id);
  } catch {
    /* ignore */
  }
};

export function Dashboard() {
  const user = useCloud((s) => s.user);
  const userLoaded = useCloud((s) => s.userLoaded);
  const close = () => getState().setAppState({ openDialog: null });

  if (!userLoaded)
    return (
      <ClDialog title="Excalimade+" onClose={close} size="small">
        <div className="cl-center">
          <Spinner />
        </div>
      </ClDialog>
    );
  if (!user)
    return (
      <ClDialog title="Sign in to Excalimade+" onClose={close} size="wide" hideHeader className="cl-dialog--auth">
        <AuthScreen onClose={close} />
      </ClDialog>
    );
  return <SignedInDashboard onClose={close} />;
}

function SignedInDashboard({ onClose }: { onClose: () => void }) {
  const user = useCloud((s) => s.user)!;
  const nonce = useCloud((s) => s.dashboardNonce);
  const currentScene = useCloud((s) => s.scene);
  const unread = useCloud((s) => s.unreadNotifications);
  const { isMobile } = useDevice();
  const theme = useStore((s) => s.appState.theme);

  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [wsId, setWsId] = useState<string | null>(readWs());
  const [collections, setCollections] = useState<Collection[]>([]);
  const [view, setView] = useState<View>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"updated" | "name" | "created">("updated");
  const [scenes, setScenes] = useState<SceneListItem[] | null>(null);
  const [trashTtl, setTrashTtl] = useState(30);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moving, setMoving] = useState<SceneListItem | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const ws = workspaces?.find((w) => w.id === wsId) ?? null;
  const canCreate = !!ws && ws.role !== "viewer";

  const loadWorkspaces = useCallback(async () => {
    try {
      const { workspaces } = await Api.workspaces();
      setWorkspaces(workspaces);
      setWsId((cur) => {
        const next = workspaces.find((w) => w.id === cur)?.id ?? workspaces.find((w) => w.personal)?.id ?? workspaces[0]?.id ?? null;
        if (next) writeWs(next);
        return next;
      });
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces, nonce]);

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const loadCollections = useCallback(async () => {
    if (!wsId) return;
    try {
      setCollections((await Api.collections(wsId)).collections);
    } catch {
      setCollections([]);
    }
  }, [wsId]);

  const loadScenes = useCallback(async () => {
    if (!wsId) return;
    try {
      const r = await Api.scenes(wsId, {
        collection: view.kind === "collection" ? view.id : null,
        trash: view.kind === "trash",
        q,
        sort,
      });
      setScenes(r.scenes);
      setTrashTtl(r.trashTtlDays);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
      setScenes([]);
    }
  }, [wsId, view, q, sort]);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections, nonce]);
  useEffect(() => {
    setScenes(null);
  }, [wsId, view]);
  useEffect(() => {
    void loadScenes();
  }, [loadScenes, nonce]);

  const reload = () => {
    void loadScenes();
    void loadCollections();
  };

  const switchWorkspace = (id: string) => {
    setWsId(id);
    writeWs(id);
    setView({ kind: "all" });
    setQuery("");
    setNavOpen(false);
  };

  const newWorkspace = async () => {
    const name = await promptDialog({ title: "Create a team workspace", label: "Workspace name", confirmLabel: "Create" });
    if (!name?.trim()) return;
    try {
      const { workspace } = await Api.createWorkspace(name.trim());
      await loadWorkspaces();
      switchWorkspace(workspace.id);
      setSettingsOpen(true);
    } catch (e) {
      toastError(e);
    }
  };

  const newCollection = async () => {
    if (!wsId) return;
    const name = await promptDialog({ title: "New collection", label: "Collection name", confirmLabel: "Create" });
    if (!name?.trim()) return;
    try {
      const { collection } = await Api.createCollection(wsId, name.trim());
      await loadCollections();
      setView({ kind: "collection", id: collection.id });
    } catch (e) {
      toastError(e);
    }
  };

  const collectionId = view.kind === "collection" ? view.id : null;

  const newScene = async () => {
    if (!wsId || busy) return;
    setBusy(true);
    try {
      await createBlankScene(wsId, collectionId);
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const hasLocalCanvas = !currentScene && getNonDeletedElements().length > 0;
  const saveCanvasHere = async () => {
    if (!wsId) return;
    setBusy(true);
    const s = await saveAsNew({ workspaceId: wsId, collectionId });
    setBusy(false);
    if (s) reload();
  };

  const open = async (s: SceneListItem) => {
    onClose();
    await openCloudScene(s.id, null);
  };

  const sceneMenu = (s: SceneListItem): MenuItem[] =>
    view.kind === "trash"
      ? [
          {
            label: "Restore",
            icon: Icon.restore(18),
            onSelect: async () => {
              try {
                await Api.restore(s.id);
                showToast(`Restored "${s.name}"`, "success");
                reload();
              } catch (e) {
                toastError(e);
              }
            },
          },
          {
            label: "Delete forever",
            icon: Icon.trash(18),
            danger: true,
            onSelect: async () => {
              const ok = await confirmDialog({
                title: "Delete forever?",
                message: `"${s.name}", its comments and its version history will be permanently deleted. This can't be undone.`,
                confirmLabel: "Delete forever",
                danger: true,
              });
              if (!ok) return;
              try {
                await Api.destroy(s.id);
                reload();
              } catch (e) {
                toastError(e);
              }
            },
          },
        ]
      : [
          { label: "Open", icon: Icon.open(18), onSelect: () => void open(s) },
          {
            label: "Rename",
            icon: Icon.edit(18),
            hidden: !canCreate,
            onSelect: async () => {
              const name = await promptDialog({ title: "Rename scene", label: "Scene name", initial: s.name, confirmLabel: "Rename" });
              if (!name?.trim() || name.trim() === s.name) return;
              try {
                const r = await Api.updateScene(s.id, null, { name: name.trim() });
                updateCurrentMeta(r.scene);
                reload();
              } catch (e) {
                toastError(e);
              }
            },
          },
          {
            label: "Duplicate",
            icon: Icon.copyScene(18),
            onSelect: async () => {
              try {
                const r = await Api.duplicate(s.id, null, canCreate ? wsId! : undefined);
                showToast(`Created "${r.scene.name}"`, "success");
                reload();
              } catch (e) {
                toastError(e);
              }
            },
          },
          { label: "Move to…", icon: Icon.move(18), hidden: !canCreate, onSelect: () => setMoving(s) },
          {
            label: "Share…",
            icon: Icon.share(18),
            onSelect: async () => {
              onClose();
              await openCloudScene(s.id, null);
              if (cloud().scene?.id === s.id) openModal({ kind: "share" });
            },
          },
          {
            label: "Move to trash",
            icon: Icon.trash(18),
            danger: true,
            hidden: !canCreate,
            onSelect: async () => {
              try {
                await Api.trash(s.id);
                showToast(`Moved "${s.name}" to the trash`);
                reload();
              } catch (e) {
                toastError(e);
              }
            },
          },
        ];

  const title = view.kind === "trash" ? "Trash" : view.kind === "collection" ? collections.find((c) => c.id === view.id)?.name ?? "Collection" : "All scenes";

  const nav = (
    <nav className="cl-dash__nav" aria-label="Workspace navigation">
      <button className={`cl-nav-item ${view.kind === "all" ? "cl-nav-item--active" : ""}`} onClick={() => (setView({ kind: "all" }), setNavOpen(false))}>
        {Icon.grid(18)} <span>All scenes</span>
      </button>
      <div className="cl-nav-section">
        <span>Collections</span>
        {canCreate && (
          <button className="cl-icon-btn cl-icon-btn--small" onClick={newCollection} aria-label="New collection" title="New collection">
            {Icon.plus(16)}
          </button>
        )}
      </div>
      {collections.length === 0 && <p className="cl-nav-empty">{canCreate ? "Group scenes into collections." : "No collections yet."}</p>}
      {collections.map((c) => (
        <div key={c.id} className={`cl-nav-item cl-nav-item--row ${view.kind === "collection" && view.id === c.id ? "cl-nav-item--active" : ""}`}>
          <button className="cl-nav-item__main" onClick={() => (setView({ kind: "collection", id: c.id }), setNavOpen(false))}>
            {Icon.folder(18)} <span className="cl-ellipsis">{c.name}</span>
            <span className="cl-nav-count">{c.sceneCount}</span>
          </button>
          {canCreate && (
            <MenuButton
              label={`Collection options for ${c.name}`}
              className="cl-icon-btn cl-icon-btn--small cl-nav-item__more"
              items={[
                {
                  label: "Rename",
                  icon: Icon.edit(18),
                  onSelect: async () => {
                    const name = await promptDialog({ title: "Rename collection", label: "Collection name", initial: c.name, confirmLabel: "Rename" });
                    if (!name?.trim()) return;
                    try {
                      await Api.renameCollection(c.id, name.trim());
                      void loadCollections();
                    } catch (e) {
                      toastError(e);
                    }
                  },
                },
                {
                  label: "Delete collection",
                  icon: Icon.trash(18),
                  danger: true,
                  onSelect: async () => {
                    const ok = await confirmDialog({
                      title: `Delete "${c.name}"?`,
                      message: "The collection is removed. Its scenes stay in the workspace under All scenes.",
                      confirmLabel: "Delete",
                      danger: true,
                    });
                    if (!ok) return;
                    try {
                      await Api.deleteCollection(c.id);
                      if (view.kind === "collection" && view.id === c.id) setView({ kind: "all" });
                      reload();
                    } catch (e) {
                      toastError(e);
                    }
                  },
                },
              ]}
            >
              {Icon.more(16)}
            </MenuButton>
          )}
        </div>
      ))}
      <div className="cl-nav-spacer" />
      <button className={`cl-nav-item ${view.kind === "trash" ? "cl-nav-item--active" : ""}`} onClick={() => (setView({ kind: "trash" }), setNavOpen(false))}>
        {Icon.trash(18)} <span>Trash</span>
      </button>
      {ws && (
        <button className="cl-nav-item" onClick={() => (setSettingsOpen(true), setNavOpen(false))}>
          {Icon.settings(18)} <span>{ws.personal ? "Workspace" : "Members & settings"}</span>
        </button>
      )}
    </nav>
  );

  return (
    <ClDialog title="Excalimade+" onClose={onClose} size="full" hideHeader className="cl-dialog--dashboard">
      <div className={`cl-dash ${theme === "dark" ? "cl-dash--dark" : ""}`}>
        <header className="cl-dash__header">
          {isMobile && (
            <button className="cl-icon-btn" onClick={() => setNavOpen((o) => !o)} aria-label="Collections" aria-expanded={navOpen}>
              {Icon.menu()}
            </button>
          )}
          <div className="cl-brand">
            <span className="cl-brand__mark">{Icon.cloud(20)}</span>
            {!isMobile && (
              <>
                Excalimade<span className="cl-brand__plus">+</span>
              </>
            )}
          </div>
          <WorkspaceSwitcher workspaces={workspaces ?? []} current={ws} onSwitch={switchWorkspace} onCreate={newWorkspace} />
          <label className="cl-search">
            {Icon.search(18)}
            <input
              className="cl-search__input"
              placeholder={isMobile ? "Search" : "Search scenes"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search scenes by name"
            />
          </label>
          <Notifications unread={unread} onOpenScene={onClose} />
          <MenuButton
            label="Account"
            className="cl-avatar-btn"
            items={[
              { label: `${user.name} · ${user.email}`, onSelect: () => openModal({ kind: "account" }), icon: Icon.settings(18) },
              { label: "Sign out", icon: Icon.logout(18), onSelect: () => void signOut().then(onClose) },
            ]}
          >
            <Avatar user={user} size={32} />
          </MenuButton>
          <button className="cl-icon-btn" onClick={onClose} aria-label="Close dashboard" title="Close">
            {Icon.close()}
          </button>
        </header>
        <div className="cl-dash__body">
          {(!isMobile || navOpen) && nav}
          <main className="cl-dash__main">
            <div className="cl-dash__toolbar">
              <div className="cl-dash__heading">
                <h2>{q ? `Results for “${q}”` : title}</h2>
                {ws && <span className="cl-muted">{ws.name}{ws.role !== "owner" ? ` · ${ws.role}` : ""}</span>}
              </div>
              <div className="cl-dash__actions">
                {view.kind !== "trash" && (
                  <select className="cl-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort scenes">
                    <option value="updated">Last modified</option>
                    <option value="created">Date created</option>
                    <option value="name">Name</option>
                  </select>
                )}
                {view.kind !== "trash" && canCreate && hasLocalCanvas && (
                  <button className="cl-btn" onClick={saveCanvasHere} disabled={busy} title="Save the drawing that's on the canvas into this workspace">
                    {Icon.cloud(18)} {isMobile ? "Save canvas" : "Save current canvas"}
                  </button>
                )}
                {view.kind !== "trash" && canCreate && (
                  <button className="cl-btn cl-btn--primary" onClick={newScene} disabled={busy}>
                    {Icon.plus(18)} New scene
                  </button>
                )}
              </div>
            </div>
            {view.kind === "trash" && (
              <p className="cl-banner-note">Scenes in the trash are permanently deleted after {trashTtl} days.</p>
            )}
            {loadError && <div className="cl-error">{loadError}</div>}
            {scenes === null ? (
              <div className="cl-grid">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="cl-card cl-card--skeleton" />
                ))}
              </div>
            ) : scenes.length === 0 ? (
              <EmptyState view={view} query={q} canCreate={canCreate} onNew={newScene} />
            ) : (
              <div className="cl-grid">
                {scenes.map((s) => (
                  <SceneCard
                    key={s.id}
                    scene={s}
                    trash={view.kind === "trash"}
                    trashTtl={trashTtl}
                    isOpen={currentScene?.id === s.id}
                    collectionName={view.kind === "all" ? collections.find((c) => c.id === s.collectionId)?.name : undefined}
                    menu={sceneMenu(s)}
                    onOpen={() => (view.kind === "trash" ? undefined : void open(s))}
                  />
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
      {settingsOpen && ws && (
        <WorkspaceSettings
          workspace={ws}
          onClose={() => setSettingsOpen(false)}
          onChanged={() => void loadWorkspaces()}
          onLeft={() => {
            setSettingsOpen(false);
            setWsId(null);
            void loadWorkspaces();
          }}
        />
      )}
      {moving && (
        <MoveDialog
          scene={moving}
          workspaces={(workspaces ?? []).filter((w) => w.role !== "viewer")}
          currentWs={wsId!}
          onClose={() => setMoving(null)}
          onMoved={() => {
            setMoving(null);
            reload();
          }}
        />
      )}
    </ClDialog>
  );
}

function WorkspaceSwitcher({ workspaces, current, onSwitch, onCreate }: { workspaces: Workspace[]; current: Workspace | null; onSwitch: (id: string) => void; onCreate: () => void }) {
  const items: MenuItem[] = [
    ...workspaces.map((w) => ({
      label: `${w.id === current?.id ? "✓ " : ""}${w.name}${w.personal ? " (personal)" : ` · ${w.memberCount} member${w.memberCount === 1 ? "" : "s"}`}`,
      icon: w.personal ? Icon.lock(18) : Icon.users(18),
      onSelect: () => onSwitch(w.id),
    })),
    { label: "Create team workspace", icon: Icon.plus(18), onSelect: onCreate },
  ];
  return (
    <MenuButton label="Switch workspace" className="cl-ws-switch" items={items} align="start">
      <span className="cl-ws-switch__badge">{current ? current.name.slice(0, 1).toUpperCase() : "…"}</span>
      <span className="cl-ellipsis cl-ws-switch__name">{current?.name ?? "Loading…"}</span>
      {Icon.chevronDown(16)}
    </MenuButton>
  );
}

function SceneCard(props: {
  scene: SceneListItem;
  trash: boolean;
  trashTtl: number;
  isOpen: boolean;
  collectionName?: string;
  menu: MenuItem[];
  onOpen: () => void;
}) {
  const { scene: s } = props;
  const [thumbOk, setThumbOk] = useState(true);
  const daysLeft = s.deletedAt ? Math.max(0, Math.ceil(props.trashTtl - (Date.now() - s.deletedAt) / 86400000)) : 0;
  return (
    <article className={`cl-card ${props.isOpen ? "cl-card--open" : ""} ${props.trash ? "cl-card--trash" : ""}`}>
      <button className="cl-card__thumb" onClick={props.onOpen} aria-label={`Open ${s.name}`} disabled={props.trash}>
        {s.hasThumb && thumbOk ? (
          <img src={thumbUrl(s.id, s.updatedAt)} alt="" loading="lazy" decoding="async" onError={() => setThumbOk(false)} />
        ) : (
          <span className="cl-card__empty">{Icon.edit(28)}</span>
        )}
        {props.isOpen && <span className="cl-chip cl-card__badge">Open now</span>}
      </button>
      <div className="cl-card__info">
        <div className="cl-card__title-row">
          <h3 className="cl-card__title cl-ellipsis" title={s.name}>
            {s.name}
          </h3>
          <MenuButton label={`Options for ${s.name}`} items={props.menu} className="cl-icon-btn cl-icon-btn--small">
            {Icon.more(18)}
          </MenuButton>
        </div>
        <div className="cl-card__meta">
          {s.owner && <Avatar user={s.owner} size={18} title={`Owner: ${s.owner.name}`} />}
          <span className="cl-ellipsis">
            {props.trash ? `Deleted ${timeAgo(s.deletedAt!)} · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : `Edited ${timeAgo(s.updatedAt)}`}
            {props.collectionName ? ` · ${props.collectionName}` : ""}
          </span>
          <span className="cl-card__vis" title={s.visibility === "private" ? "Private" : s.visibility === "link" ? "Anyone with the link" : "Workspace"}>
            {s.visibility === "private" ? Icon.lock(14) : s.visibility === "link" ? Icon.globe(14) : Icon.users(14)}
          </span>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ view, query, canCreate, onNew }: { view: View; query: string; canCreate: boolean; onNew: () => void }) {
  return (
    <div className="cl-empty">
      <span className="cl-empty__icon">{view.kind === "trash" ? Icon.trash(36) : query ? Icon.search(36) : Icon.cloud(36)}</span>
      <h3>{query ? "No scenes match your search" : view.kind === "trash" ? "The trash is empty" : view.kind === "collection" ? "This collection is empty" : "No scenes yet"}</h3>
      <p className="cl-muted">
        {query
          ? "Try a different name."
          : view.kind === "trash"
            ? "Deleted scenes show up here so you can restore them."
            : canCreate
              ? "Create a scene, or save the drawing on your canvas with “Export to Excalimade+”."
              : "Scenes shared with this workspace will show up here."}
      </p>
      {!query && view.kind !== "trash" && canCreate && (
        <button className="cl-btn cl-btn--primary" onClick={onNew}>
          {Icon.plus(18)} New scene
        </button>
      )}
    </div>
  );
}

function MoveDialog({ scene, workspaces, currentWs, onClose, onMoved }: { scene: SceneListItem; workspaces: Workspace[]; currentWs: string; onClose: () => void; onMoved: () => void }) {
  const [wsId, setWsId] = useState(currentWs);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState<string>(wsId === currentWs ? scene.collectionId ?? "" : "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    Api.collections(wsId)
      .then((r) => alive && setCollections(r.collections))
      .catch(() => alive && setCollections([]));
    return () => {
      alive = false;
    };
  }, [wsId]);
  const submit = async () => {
    setBusy(true);
    try {
      if (wsId !== currentWs) {
        await Api.updateScene(scene.id, null, { workspaceId: wsId });
        if (collectionId) await Api.updateScene(scene.id, null, { collectionId });
      } else await Api.updateScene(scene.id, null, { collectionId: collectionId || null });
      showToast(`Moved "${scene.name}"`, "success");
      setCloud((s) => ({ dashboardNonce: s.dashboardNonce + 1 }));
      onMoved();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ClDialog
      title={`Move “${scene.name}”`}
      onClose={onClose}
      size="small"
      footer={
        <>
          <button className="cl-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="cl-btn cl-btn--primary" onClick={submit} disabled={busy}>
            {busy ? <Spinner size={16} /> : "Move"}
          </button>
        </>
      }
    >
      <div className="cl-form">
        <label className="cl-field">
          <span>Workspace</span>
          <select className="cl-select" value={wsId} onChange={(e) => (setWsId(e.target.value), setCollectionId(""))}>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.personal ? " (personal)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="cl-field">
          <span>Collection</span>
          <select className="cl-select" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
            <option value="">No collection</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {wsId !== currentWs && (
          <p className="cl-muted cl-small">
            Moving to another workspace resets the scene's share links and per-person access, and starts a new live-collaboration room.
          </p>
        )}
      </div>
    </ClDialog>
  );
}

function Notifications({ unread, onOpenScene }: { unread: number; onOpenScene: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try {
      const r = await Api.notifications();
      setItems(r.items);
      setCloud({ unreadNotifications: r.unread });
    } catch (e) {
      toastError(e);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!open) return;
    void load();
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [open, load]);
  const unreadItems = useMemo(() => items?.filter((n) => !n.read) ?? [], [items]);
  const go = async (n: Notification) => {
    setOpen(false);
    if (!n.read) void Api.readNotifications([n.id]).then(() => setCloud((s) => ({ unreadNotifications: Math.max(0, s.unreadNotifications - 1) })));
    onOpenScene();
    await openCloudScene(n.sceneId, null, { threadId: n.threadId });
  };
  return (
    <div className="cl-notif" ref={ref}>
      <button className="cl-icon-btn" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} title="Notifications" aria-expanded={open}>
        {Icon.bell()}
        {unread > 0 && <span className="cl-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="cl-notif__panel" role="dialog" aria-label="Notifications">
          <div className="cl-notif__head">
            <strong>Notifications</strong>
            {unreadItems.length > 0 && (
              <button
                className="cl-link"
                onClick={async () => {
                  try {
                    await Api.readNotifications();
                    setItems((it) => it?.map((n) => ({ ...n, read: true })) ?? null);
                    setCloud({ unreadNotifications: 0 });
                  } catch (e) {
                    toastError(e);
                  }
                }}
              >
                Mark all as read
              </button>
            )}
          </div>
          {items === null ? (
            <div className="cl-center">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <p className="cl-muted cl-notif__empty">You're all caught up. Mentions and replies to your comments show up here.</p>
          ) : (
            <ul className="cl-notif__list">
              {items.map((n) => (
                <li key={n.id}>
                  <button className={`cl-notif__item ${n.read ? "" : "cl-notif__item--unread"}`} onClick={() => void go(n)}>
                    <Avatar user={n.actor} size={30} />
                    <span className="cl-notif__text">
                      <span>
                        <strong>{n.actor?.name ?? "Someone"}</strong> {n.kind === "mention" ? "mentioned you in" : "replied in"} <strong>{n.sceneName}</strong>
                      </span>
                      <span className="cl-notif__snippet">{n.snippet}</span>
                      <span className="cl-muted cl-small">{timeAgo(n.createdAt)}</span>
                    </span>
                    {!n.read && <span className="cl-dot" aria-label="Unread" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
