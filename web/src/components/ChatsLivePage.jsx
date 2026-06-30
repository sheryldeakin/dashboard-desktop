import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../utils/taskUtils.js";

const POLL_INTERVAL_MS = 5000;
const FOCUS_POLL_RECOVERY_MS = 2000;

function formatIdleLabel(idleMinutes) {
  if (idleMinutes == null) return "—";
  if (idleMinutes < 1) return "active now";
  if (idleMinutes < 60) return `${idleMinutes}m idle`;
  const hours = Math.floor(idleMinutes / 60);
  const mins = idleMinutes % 60;
  if (hours < 24) return mins ? `${hours}h ${mins}m idle` : `${hours}h idle`;
  return `${Math.floor(hours / 24)}d idle`;
}

function activityClass(idleMinutes) {
  if (idleMinutes == null) return "chats-live-card--idle";
  if (idleMinutes < 5) return "chats-live-card--active";
  if (idleMinutes < 15) return "chats-live-card--recent";
  return "chats-live-card--idle";
}

function formatTokens(tokens) {
  if (!tokens) return null;
  const total = (tokens.input || 0) + (tokens.cacheRead || 0) + (tokens.cacheCreation || 0);
  if (!total && !tokens.output) return null;
  const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
  return `${k(total)} in / ${k(tokens.output || 0)} out`;
}

function shortSession(sessionId) {
  if (!sessionId) return "—";
  return sessionId.slice(0, 8);
}

function ChatCard({ session, onFocus, focusing }) {
  const idleLabel = formatIdleLabel(session.idleMinutes);
  const tokensLabel = formatTokens(session.tokens);
  const variant = activityClass(session.idleMinutes);

  return (
    <article className={`chats-live-card ${variant}`}>
      <header className="chats-live-card-header">
        <span className="chats-live-card-pill" title={session.cwd}>{session.projectLabel}</span>
        <span className="chats-live-card-idle">{idleLabel}</span>
      </header>
      <div className="chats-live-card-meta">
        <span className="chats-live-card-session" title={session.sessionId}>
          {shortSession(session.sessionId)}
        </span>
        {session.gitBranch && (
          <span className="chats-live-card-branch">{session.gitBranch}</span>
        )}
        <span className="chats-live-card-count">
          {session.messageCount} msg
        </span>
      </div>
      {session.lastUserText && (
        <div className="chats-live-card-line chats-live-card-line--user">
          <span className="chats-live-card-line-tag">you</span>
          <span className="chats-live-card-line-text">{session.lastUserText}</span>
        </div>
      )}
      {session.lastAssistantText && (
        <div className="chats-live-card-line chats-live-card-line--assistant">
          <span className="chats-live-card-line-tag">claude</span>
          <span className="chats-live-card-line-text">{session.lastAssistantText}</span>
        </div>
      )}
      <footer className="chats-live-card-footer">
        {tokensLabel && <span className="chats-live-card-tokens">{tokensLabel}</span>}
        <button
          type="button"
          className="chats-live-card-focus"
          onClick={() => onFocus(session)}
          disabled={focusing}
          title={`Focus terminal in ${session.cwd}`}
        >
          {focusing ? "…" : "Focus"}
        </button>
      </footer>
    </article>
  );
}

export default function ChatsLivePage() {
  const [sessions, setSessions] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [focusBusy, setFocusBusy] = useState(null);
  const [focusToast, setFocusToast] = useState(null);
  const liveRegionRef = useRef(null);

  const load = useCallback(async () => {
    if (!API_BASE_URL) {
      setError("API_BASE_URL not configured (set VITE_API_URL).");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/chats-live`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      setGeneratedAt(data.generatedAt || null);
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load live chats.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    const visibilityHandler = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", visibilityHandler);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", visibilityHandler);
    };
  }, [load]);

  const handleFocus = useCallback(async (session) => {
    if (!session.cwd || !API_BASE_URL) {
      setFocusToast("No cwd available for this session.");
      return;
    }
    setFocusBusy(session.sessionId);
    try {
      const res = await fetch(`${API_BASE_URL}/api/focus-terminal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: session.cwd, sessionId: session.sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFocusToast(data.error || `Focus failed (HTTP ${res.status}).`);
      } else if (data.matched) {
        setFocusToast(`Focused: ${data.windowTitle || session.projectLabel}`);
      } else {
        setFocusToast(data.reason || "No matching terminal window found.");
      }
    } catch (err) {
      setFocusToast(err.message || "Focus request failed.");
    } finally {
      setFocusBusy(null);
      setTimeout(() => setFocusToast(null), 4000);
      setTimeout(load, FOCUS_POLL_RECOVERY_MS);
    }
  }, [load]);

  const lastUpdatedLabel = useMemo(() => {
    if (!generatedAt) return null;
    const date = new Date(generatedAt);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleTimeString();
  }, [generatedAt]);

  return (
    <div className="chats-live-page">
      <header className="chats-live-header">
        <div>
          <h1 className="chats-live-title">Live chats</h1>
          <p className="chats-live-subtitle">
            Claude Code sessions active in the last 30 minutes. Polls every {POLL_INTERVAL_MS / 1000}s.
          </p>
        </div>
        <div className="chats-live-status" aria-live="polite" ref={liveRegionRef}>
          {loading && !sessions.length ? "Loading…" : null}
          {error ? <span className="chats-live-error">{error}</span> : null}
          {!error && lastUpdatedLabel ? (
            <span className="chats-live-updated">Updated {lastUpdatedLabel}</span>
          ) : null}
        </div>
      </header>

      {focusToast && <div className="chats-live-toast" role="status">{focusToast}</div>}

      {!loading && !error && !sessions.length && (
        <div className="chats-live-empty">
          No Claude Code sessions active in the last 30 minutes.
        </div>
      )}

      <div className="chats-live-grid">
        {sessions.map((s) => (
          <ChatCard
            key={s.sessionId}
            session={s}
            onFocus={handleFocus}
            focusing={focusBusy === s.sessionId}
          />
        ))}
      </div>
    </div>
  );
}
