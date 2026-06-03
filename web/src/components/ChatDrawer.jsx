import { useEffect, useRef, useState } from "react";
import { useChatBridge } from "../hooks/useChatBridge.js";

/* Bottom-bar chat drawer. Collapsed: 36px-tall status bar + input prompt.
   Expanded: ~50vh chat history + input + send/interrupt. Click anywhere
   in the collapsed bar (or focus the input) to expand.
   Future: move to its own tab once we know we like it here. */

function StatusDot({ status }) {
  const cls =
    status === "connected" ? "is-ok"
    : status === "connecting" ? "is-pending"
    : status === "needs-pair" ? "is-pair"
    : "is-off";
  return <span className={`home-chat-dot ${cls}`} aria-hidden="true" />;
}

function statusLabel(status) {
  switch (status) {
    case "connected":   return "Connected to local bridge";
    case "connecting":  return "Connecting…";
    case "needs-pair":  return "Bridge running — needs pair token";
    case "offline":     return "Bridge not running";
    case "error":       return "Connection error";
    default:            return "Connecting…";
  }
}

function PairTokenPrompt({ onPaste, onRetry }) {
  const [val, setVal] = useState("");
  return (
    <div className="home-chat-pair">
      <p className="home-chat-pair-msg">
        Bridge reachable but needs the pair token. Copy it from the bridge
        console (printed at startup) and paste below, or restart the bridge
        within 60s of dashboard load for auto-pair.
      </p>
      <form
        className="home-chat-pair-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (val.trim()) onPaste(val.trim());
        }}
      >
        <input
          type="text"
          className="home-chat-pair-input"
          placeholder="paste token here"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          autoFocus
        />
        <button type="submit" className="home-chat-pair-btn">Pair</button>
        <button type="button" className="home-chat-pair-btn home-chat-pair-btn-secondary" onClick={onRetry}>
          Retry auto-pair
        </button>
      </form>
    </div>
  );
}

function OfflineHint({ onRetry }) {
  return (
    <div className="home-chat-pair">
      <p className="home-chat-pair-msg">
        Bridge not reachable at <code>127.0.0.1:4100</code>. Start it with:
      </p>
      <pre className="home-chat-pair-code">cd C:\Users\Sheryl\Projects\dashboard-chat-bridge
npm start</pre>
      <button type="button" className="home-chat-pair-btn" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

function ModeToggle({ mode, onSwitch, disabled }) {
  const isVault = mode === "vault";
  const next = isVault ? "web" : "vault";
  const label = isVault ? "🔒 Vault" : "🌐 Web";
  const tooltip = isVault
    ? "Vault mode: Claude can read your vault + dashboard, search the web. No URL fetches (defense against vault-exfil). Click to switch to Web mode."
    : "Web mode: Claude can fetch + search the web. No vault access. Click to switch to Vault mode.";
  return (
    <button
      type="button"
      className={`home-chat-mode home-chat-mode-${mode}`}
      onClick={() => onSwitch(next)}
      title={tooltip}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

export default function ChatDrawer() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const {
    status, messages, thinking, mode, switchMode,
    sendPrompt, interrupt, setManualToken, retry,
  } = useChatBridge();

  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, thinking]);

  function handleSubmit(e) {
    e?.preventDefault();
    if (!input.trim() || status !== "connected" || thinking) return;
    sendPrompt(input);
    setInput("");
  }

  function handleKeyDown(e) {
    // Enter sends; Shift+Enter newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const canSend = status === "connected" && !thinking && input.trim().length > 0;

  return (
    <section className={`home-chat-drawer${open ? " is-open" : ""}`} aria-label="Chat with Claude">
      <header className="home-chat-bar">
        <button
          type="button"
          className="home-chat-toggle"
          onClick={() => setOpen((p) => !p)}
          aria-label={open ? "Collapse chat" : "Expand chat"}
          aria-expanded={open}
        >
          <span className="home-chat-toggle-icon">{open ? "⌄" : "⌃"}</span>
        </button>
        <StatusDot status={status} />
        <span className="home-chat-status">{statusLabel(status)}</span>
        {status === "connected" && (
          <ModeToggle mode={mode} onSwitch={switchMode} disabled={thinking} />
        )}
        {!open && status === "connected" && (
          <input
            type="text"
            className="home-chat-quickinput"
            placeholder={mode === "vault" ? "Ask Claude about your vault…" : "Search/fetch the web…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
          />
        )}
        {thinking && <span className="home-chat-thinking">thinking…</span>}
      </header>

      {open && (
        <div className="home-chat-body">
          {status === "needs-pair" && (
            <PairTokenPrompt onPaste={setManualToken} onRetry={retry} />
          )}
          {status === "offline" && <OfflineHint onRetry={retry} />}

          {(status === "connected" || messages.length > 0) && (
            <>
              <div className="home-chat-messages" ref={scrollRef}>
                {messages.length === 0 && (
                  <p className="home-chat-empty">
                    No messages yet. Ask anything about your vault or this codebase —
                    Claude has read-only access to <code>second_brain/</code> and the
                    dashboard repo.
                  </p>
                )}
                {messages.map((m) => (
                  <div key={m.id} className={`home-chat-msg home-chat-msg-${m.role}`}>
                    <div className="home-chat-msg-role">
                      {m.role === "user" ? "You" : m.role === "assistant" ? "Claude" : "System"}
                    </div>
                    <div className="home-chat-msg-text">{m.text}</div>
                  </div>
                ))}
                {thinking && (
                  <div className="home-chat-msg home-chat-msg-assistant home-chat-msg-thinking">
                    <div className="home-chat-msg-role">Claude</div>
                    <div className="home-chat-msg-text">
                      <span className="home-chat-dots"><span/><span/><span/></span>
                    </div>
                  </div>
                )}
              </div>

              <form className="home-chat-input-row" onSubmit={handleSubmit}>
                <textarea
                  className="home-chat-input"
                  placeholder={status === "connected" ? "Message Claude (Enter to send, Shift+Enter for newline)" : "Connect first…"}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={2}
                  disabled={status !== "connected"}
                />
                {thinking ? (
                  <button type="button" className="home-chat-btn home-chat-btn-stop" onClick={interrupt}>
                    Stop
                  </button>
                ) : (
                  <button type="submit" className="home-chat-btn" disabled={!canSend}>
                    Send
                  </button>
                )}
              </form>
            </>
          )}
        </div>
      )}
    </section>
  );
}
