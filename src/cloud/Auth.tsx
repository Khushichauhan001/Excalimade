// Sign in / sign up screen shown in the dashboard when signed out.
import { useState, type FormEvent } from "react";
import { showToast } from "../core/store";
import { Api } from "./api";
import { cloud, setCloud } from "./session";
import { errorMessage, onSignedIn } from "./controller";
import { Icon, Spinner } from "./ui";

const FEATURES: [ReturnType<typeof Icon.cloud>, string, string][] = [
  [Icon.cloud(22), "Unlimited cloud scenes", "Autosaved, organised in collections, available everywhere."],
  [Icon.users(22), "Team workspaces", "Invite your team with roles, share links and embeds."],
  [Icon.comment(22), "Comments & mentions", "Pin feedback to the canvas and @mention teammates."],
  [Icon.history(22), "Version history", "Preview and restore any earlier version of a scene."],
];

export function AuthScreen({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = cloud().pending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (tab === "signup" && password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      const { user } = tab === "signin" ? await Api.signIn(email, password) : await Api.signUp(name, email, password);
      setCloud({ user });
      showToast(tab === "signin" ? `Welcome back, ${user.name.split(" ")[0]}!` : `Welcome to Excalimade+, ${user.name.split(" ")[0]}!`, "success");
      await onSignedIn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cl-auth">
      <aside className="cl-auth__hero">
        <div className="cl-brand cl-brand--light">
          <span className="cl-brand__mark">{Icon.cloud(22)}</span> Excalimade<span className="cl-brand__plus">+</span>
        </div>
        <h2 className="cl-auth__headline">Your whiteboard, saved & shared with your team.</h2>
        <ul className="cl-auth__features">
          {FEATURES.map(([icon, title, text]) => (
            <li key={title}>
              <span className="cl-auth__feature-icon">{icon}</span>
              <div>
                <strong>{title}</strong>
                <span>{text}</span>
              </div>
            </li>
          ))}
        </ul>
      </aside>
      <section className="cl-auth__panel">
        <button className="cl-icon-btn cl-auth__close" onClick={onClose} aria-label="Close" title="Close">
          {Icon.close()}
        </button>
        <div className="cl-tabs" role="tablist">
          {(["signin", "signup"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`cl-tab ${tab === t ? "cl-tab--active" : ""}`}
              onClick={() => {
                setTab(t);
                setError(null);
              }}
            >
              {t === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>
        <h3 className="cl-auth__title">{tab === "signin" ? "Welcome back" : "Create your free account"}</h3>
        <p className="cl-muted cl-auth__sub">
          {pending?.kind === "invite"
            ? "Sign in to join the workspace you were invited to."
            : pending?.kind === "open"
              ? "Sign in to open the shared scene."
              : pending?.kind === "saveAs"
                ? "Sign in to save your drawing to the cloud."
                : tab === "signin"
                  ? "Sign in to access your scenes and workspaces."
                  : "Store unlimited scenes and collaborate with your team."}
        </p>
        <form className="cl-form" onSubmit={submit}>
          {tab === "signup" && (
            <label className="cl-field">
              <span>Name</span>
              <input className="cl-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={60} placeholder="Ada Lovelace" />
            </label>
          )}
          <label className="cl-field">
            <span>Email</span>
            <input className="cl-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required maxLength={254} placeholder="you@company.com" />
          </label>
          <label className="cl-field">
            <span>Password</span>
            <input
              className="cl-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={tab === "signin" ? "current-password" : "new-password"}
              required
              minLength={tab === "signup" ? 8 : undefined}
              maxLength={200}
              placeholder={tab === "signup" ? "At least 8 characters" : "Your password"}
            />
          </label>
          {error && (
            <div className="cl-error" role="alert">
              {error}
            </div>
          )}
          <button className="cl-btn cl-btn--primary cl-btn--large" type="submit" disabled={busy}>
            {busy ? <Spinner size={16} /> : tab === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        <p className="cl-muted cl-auth__switch">
          {tab === "signin" ? "New to Excalimade+? " : "Already have an account? "}
          <button className="cl-link" onClick={() => setTab(tab === "signin" ? "signup" : "signin")}>
            {tab === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </section>
    </div>
  );
}
