import { useCallback, useEffect, useRef, useState } from "react";

/* Connects /home's chat drawer to the local dashboard-chat-bridge.
 *
 * Connection states:
 *   "idle"         — initial, before first connect attempt
 *   "connecting"   — WS handshake in flight
 *   "needs-pair"   — bridge reachable but no token (or stored token rejected)
 *   "connected"    — WS open, ready for prompts
 *   "offline"      — couldn't reach bridge at all
 *   "error"        — WS open then dropped, or unexpected failure
 *
 * Token flow:
 *   1. Try the token in localStorage (if any).
 *   2. If absent or rejected, try GET /pair (only succeeds within 60s of
 *      bridge startup). Save the returned token to localStorage and
 *      reconnect.
 *   3. If /pair also fails, surface "needs-pair" so the UI can prompt the
 *      user to paste a token from the bridge console.
 *
 * Messages stay in memory only — no persistence yet (Phase 3). */

const DEFAULT_URL = "http://127.0.0.1:4100";
const TOKEN_KEY = "dashboard_chat_bridge_token";

function wsUrlFor(baseHttp, token) {
  const u = new URL(baseHttp);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.searchParams.set("token", token);
  return u.toString();
}

export function useChatBridge({ baseUrl = DEFAULT_URL } = {}) {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [messages, setMessages] = useState([]); // {id, role:'user'|'assistant'|'system', text, t}
  const [thinking, setThinking] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const wsRef = useRef(null);
  const currentTurnRef = useRef(null); // {assistantBuffer, started}

  const connectWith = useCallback((token) => {
    if (!token) {
      setStatus("needs-pair");
      return;
    }
    setStatus("connecting");
    setError(null);
    try {
      const ws = new WebSocket(wsUrlFor(baseUrl, token));
      wsRef.current = ws;
      ws.onopen = () => setStatus("connected");
      ws.onerror = () => {
        // We can't tell the close code from onerror; the close handler
        // figures out 401 vs offline via the code.
      };
      ws.onclose = (e) => {
        wsRef.current = null;
        // 1006 = abnormal closure (no handshake / network gone)
        // 1008 = policy violation, used by ws for 401/403 in some versions
        if (e.code === 1006 && status === "connecting") {
          // Couldn't even handshake — try /pair to recover, then offline.
          tryPair().catch(() => setStatus("offline"));
        } else if (status === "connected") {
          setStatus("error");
          setError("Connection dropped. The bridge may have restarted.");
        }
        setThinking(false);
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        handleEvent(msg);
      };
    } catch (e) {
      setStatus("offline");
      setError(e.message);
    }
  }, [baseUrl, status]);

  const tryPair = useCallback(async () => {
    try {
      const r = await fetch(`${baseUrl}/pair`, { method: "GET" });
      if (!r.ok) {
        if (r.status === 403) {
          setStatus("needs-pair");
          return;
        }
        throw new Error(`pair returned ${r.status}`);
      }
      const { token } = await r.json();
      if (!token) throw new Error("pair returned no token");
      localStorage.setItem(TOKEN_KEY, token);
      connectWith(token);
    } catch (e) {
      // bridge unreachable
      setStatus("offline");
      setError(e.message);
    }
  }, [baseUrl, connectWith]);

  const handleEvent = useCallback((msg) => {
    const { kind, payload } = msg;
    if (kind === "pong") return;
    if (kind === "start") {
      setThinking(true);
      currentTurnRef.current = { assistantBuffer: "", started: Date.now() };
      return;
    }
    if (kind === "claude") {
      const t = payload?.type;
      // Accumulate text from assistant events; show only when turn ends.
      if (t === "assistant" && payload.message?.content) {
        const text = payload.message.content
          .map((c) => (c.type === "text" ? c.text : ""))
          .join("");
        if (currentTurnRef.current) {
          currentTurnRef.current.assistantBuffer += text;
        }
      }
      return;
    }
    if (kind === "stderr") {
      // Surface stderr only on failure end; for now log it
      console.warn("[chat-bridge stderr]", payload);
      return;
    }
    if (kind === "end") {
      const turn = currentTurnRef.current;
      currentTurnRef.current = null;
      setThinking(false);
      if (payload?.sessionId) setSessionId(payload.sessionId);
      const text = turn?.assistantBuffer?.trim() || "(no reply)";
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text, t: Date.now() },
      ]);
      return;
    }
    if (kind === "error") {
      setThinking(false);
      currentTurnRef.current = null;
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: "system", text: `Error: ${payload?.message || "unknown"}`, t: Date.now() },
      ]);
      return;
    }
    if (kind === "interrupted") {
      setThinking(false);
      currentTurnRef.current = null;
      setMessages((prev) => [
        ...prev,
        { id: `i-${Date.now()}`, role: "system", text: "Interrupted.", t: Date.now() },
      ]);
      return;
    }
  }, []);

  // Initial connect attempt
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) {
      connectWith(stored);
    } else {
      tryPair();
    }
    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close(1000, "unmount");
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendPrompt = useCallback((text) => {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError("Not connected to bridge.");
      return;
    }
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", text: trimmed, t: Date.now() },
    ]);
    ws.send(JSON.stringify({ type: "prompt", text: trimmed }));
  }, []);

  const interrupt = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "interrupt" }));
    }
  }, []);

  const setManualToken = useCallback((token) => {
    if (!token) return;
    localStorage.setItem(TOKEN_KEY, token.trim());
    connectWith(token.trim());
  }, [connectWith]);

  const retry = useCallback(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) connectWith(stored);
    else tryPair();
  }, [connectWith, tryPair]);

  return {
    status,
    error,
    messages,
    thinking,
    sessionId,
    sendPrompt,
    interrupt,
    setManualToken,
    retry,
  };
}
