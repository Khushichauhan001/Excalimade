// Workspace settings: name, members & roles, invite link, add by email, leave / delete.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { showToast } from "../core/store";
import { Api, type Member, type Workspace } from "./api";
import { useCloud, type WorkspaceRole } from "./session";
import { confirmDialog, errorMessage, toastError } from "./controller";
import { Avatar, ClDialog, CopyField, Icon, ROLE_HINT, ROLE_LABEL, Spinner, timeAgo } from "./ui";

const inviteUrl = (token: string) => `${location.origin}${location.pathname}#invite=${token}`;

export function WorkspaceSettings({ workspace, onClose, onChanged, onLeft }: { workspace: Workspace; onClose: () => void; onChanged: () => void; onLeft: () => void }) {
  const me = useCloud((s) => s.user)!;
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invite, setInvite] = useState<{ token: string | null; role: WorkspaceRole } | null>(null);
  const [name, setName] = useState(workspace.name);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = workspace.role === "owner" || workspace.role === "admin";
  const isOwner = workspace.role === "owner";

  const load = useCallback(async () => {
    try {
      const r = await Api.members(workspace.id);
      setMembers(r.members);
      setInvite(r.invite);
    } catch (e) {
      toastError(e);
    }
  }, [workspace.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const rename = async () => {
    const n = name.trim();
    if (!n || n === workspace.name) return;
    try {
      await Api.renameWorkspace(workspace.id, n);
      onChanged();
      showToast("Workspace renamed", "success");
    } catch (e) {
      toastError(e);
      setName(workspace.name);
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setAddError(null);
    setBusy(true);
    try {
      await Api.addMember(workspace.id, email.trim(), role);
      setEmail("");
      showToast("Member added", "success");
      await load();
      onChanged();
    } catch (err) {
      setAddError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (m: Member, r: WorkspaceRole) => {
    if (r === "owner") {
      const ok = await confirmDialog({
        title: `Transfer ownership to ${m.name}?`,
        message: "They become the owner of this workspace and you become an admin. Only the new owner can undo this.",
        confirmLabel: "Transfer ownership",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await Api.setMemberRole(workspace.id, m.id, r);
      await load();
      onChanged();
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async (m: Member) => {
    const self = m.id === me.id;
    const ok = await confirmDialog({
      title: self ? `Leave ${workspace.name}?` : `Remove ${m.name}?`,
      message: self
        ? "You'll lose access to this workspace's scenes. Scenes you own stay in the workspace."
        : `${m.name} loses access to this workspace. Scenes they own stay in the workspace and are transferred to the owner.`,
      confirmLabel: self ? "Leave workspace" : "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await Api.removeMember(workspace.id, m.id);
      if (self) {
        showToast(`You left ${workspace.name}`);
        onLeft();
      } else {
        await load();
        onChanged();
      }
    } catch (e) {
      toastError(e);
    }
  };

  const updateInvite = async (opts: { role?: WorkspaceRole; regenerate?: boolean; disable?: boolean }) => {
    try {
      const r = await Api.updateInvite(workspace.id, opts);
      setInvite(r.invite);
      if (opts.regenerate) showToast("New invite link created — the old one no longer works", "success");
    } catch (e) {
      toastError(e);
    }
  };

  const deleteWorkspace = async () => {
    const ok = await confirmDialog({
      title: `Delete ${workspace.name}?`,
      message: "All scenes, collections, comments and versions in this workspace are permanently deleted for everyone. This can't be undone.",
      confirmLabel: "Delete workspace",
      danger: true,
    });
    if (!ok) return;
    try {
      await Api.deleteWorkspace(workspace.id);
      showToast(`Deleted ${workspace.name}`);
      onLeft();
    } catch (e) {
      toastError(e);
    }
  };

  const assignable: WorkspaceRole[] = isOwner ? ["owner", "admin", "member", "viewer"] : ["admin", "member", "viewer"];

  return (
    <ClDialog title={workspace.personal ? "Personal workspace" : "Workspace settings"} onClose={onClose} size="regular">
      <div className="cl-settings">
        <section className="cl-section">
          <label className="cl-field">
            <span>Workspace name</span>
            <input
              className="cl-input"
              value={name}
              disabled={!isAdmin}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            />
          </label>
        </section>

        {workspace.personal ? (
          <section className="cl-section cl-callout">
            {Icon.lock(20)}
            <div>
              <strong>Only you can see this workspace.</strong>
              <p className="cl-muted">Create a team workspace from the workspace switcher to invite people, or share individual scenes with a link.</p>
            </div>
          </section>
        ) : (
          <>
            {isAdmin && invite && (
              <section className="cl-section">
                <h3 className="cl-section__title">Invite link</h3>
                {invite.token ? (
                  <>
                    <p className="cl-muted cl-small">Anyone with this link can join after signing in.</p>
                    <CopyField value={inviteUrl(invite.token)} label="Invite link" />
                    <div className="cl-row cl-row--wrap">
                      <label className="cl-inline-field">
                        Joins as
                        <select className="cl-select cl-select--small" value={invite.role} onChange={(e) => void updateInvite({ role: e.target.value as WorkspaceRole })}>
                          {(["admin", "member", "viewer"] as const).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className="cl-btn cl-btn--small" onClick={() => void updateInvite({ regenerate: true })}>
                        {Icon.restore(16)} Reset link
                      </button>
                      <button className="cl-btn cl-btn--small cl-btn--danger-ghost" onClick={() => void updateInvite({ disable: true })}>
                        Disable
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="cl-row">
                    <span className="cl-muted cl-small">The invite link is disabled.</span>
                    <button className="cl-btn cl-btn--small" onClick={() => void updateInvite({ regenerate: true })}>
                      {Icon.link(16)} Create invite link
                    </button>
                  </div>
                )}
              </section>
            )}

            {isAdmin && (
              <section className="cl-section">
                <h3 className="cl-section__title">Add by email</h3>
                <form className="cl-row cl-row--wrap" onSubmit={add}>
                  <input
                    className="cl-input cl-grow"
                    type="email"
                    placeholder="teammate@company.com"
                    value={email}
                    required
                    onChange={(e) => setEmail(e.target.value)}
                    aria-label="Email of an existing Excalimade+ user"
                  />
                  <select className="cl-select" value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)} aria-label="Role">
                    {(["admin", "member", "viewer"] as const).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <button className="cl-btn cl-btn--primary" type="submit" disabled={busy || !email.trim()}>
                    {busy ? <Spinner size={16} /> : "Add"}
                  </button>
                </form>
                {addError && <div className="cl-error">{addError}</div>}
              </section>
            )}
          </>
        )}

        <section className="cl-section">
          <h3 className="cl-section__title">
            Members {members && <span className="cl-muted">· {members.length}</span>}
          </h3>
          {members === null ? (
            <div className="cl-center">
              <Spinner />
            </div>
          ) : (
            <ul className="cl-members">
              {members.map((m) => {
                const self = m.id === me.id;
                const editable = isAdmin && !self && m.role !== "owner" && !(workspace.role === "admin" && m.role === "admin");
                return (
                  <li key={m.id} className="cl-member">
                    <Avatar user={m} size={34} />
                    <div className="cl-member__info">
                      <strong className="cl-ellipsis">
                        {m.name}
                        {self ? " (you)" : ""}
                      </strong>
                      <span className="cl-muted cl-small cl-ellipsis">
                        {m.email} · joined {timeAgo(m.joinedAt)}
                      </span>
                    </div>
                    {editable ? (
                      <select className="cl-select cl-select--small" value={m.role} onChange={(e) => void changeRole(m, e.target.value as WorkspaceRole)} aria-label={`Role of ${m.name}`} title={ROLE_HINT[m.role]}>
                        {assignable.map((r) => (
                          <option key={r} value={r}>
                            {r === "owner" ? "Make owner" : ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="cl-chip" title={ROLE_HINT[m.role]}>
                        {ROLE_LABEL[m.role]}
                      </span>
                    )}
                    {(editable || (self && m.role !== "owner")) && (
                      <button className="cl-icon-btn cl-icon-btn--small" onClick={() => void remove(m)} aria-label={self ? "Leave workspace" : `Remove ${m.name}`} title={self ? "Leave workspace" : "Remove from workspace"}>
                        {self ? Icon.logout(16) : Icon.close(16)}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {isOwner && !workspace.personal && (
          <section className="cl-section cl-danger-zone">
            <div>
              <strong>Delete workspace</strong>
              <p className="cl-muted cl-small">Permanently deletes every scene in this workspace.</p>
            </div>
            <button className="cl-btn cl-btn--danger" onClick={deleteWorkspace}>
              {Icon.trash(16)} Delete
            </button>
          </section>
        )}
      </div>
    </ClDialog>
  );
}
