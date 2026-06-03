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
  const [messages, setMessages] = useState([]); // {id, role, text, mode, t, kind?, preSha?, diffStat?}
  const [thinking, setThinking] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [mode, setMode] = useState("vault"); // 'strict' | 'vault' | 'web' | 'apply'
  /* Apply-mode state: when a plan completes, we remember the message id
     so the UI knows which card is the live "Apply / Discard" affordance. */
  const [pendingPlanMsgId, setPendingPlanMsgId] = useState(null);
  const wsRef = useRef(null);
  const currentTurnRef = useRef(null); // {assistantBuffer, started, phase}

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
    if (kind === "start" || kind === "apply-start") {
      setThinking(true);
      currentTurnRef.current = {
        assistantBuffer: "",
        started: Date.now(),
        phase: payload?.phase, // 'plan' | 'execute' | undefined
        preSha: payload?.preSha,
      };
      return;
    }
    if (kind === "claude") {
      const t = payload?.type;
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
      console.warn("[chat-bridge stderr]", payload);
      return;
    }
    if (kind === "end") {
      const turn = currentTurnRef.current;
      currentTurnRef.current = null;
      setThinking(false);
      if (payload?.sessionId) setSessionId(payload.sessionId);
      const text = turn?.assistantBuffer?.trim() || "(no reply)";
      const id = `a-${Date.now()}`;
      // For apply-plan turns, mark as a "plan" message so the UI shows
      // Apply/Discard buttons. plan-ready event flags the live one.
      const isPlan = turn?.phase === "plan";
      setMessages((prev) => [
        ...prev,
        {
          id,
          role: "assistant",
          text,
          mode,
          kind: isPlan ? "plan" : (turn?.phase === "execute" ? "apply" : undefined),
          t: Date.now(),
        },
      ]);
      return;
    }
    if (kind === "plan-ready") {
      // Marks the most recent plan message as the live one (Apply available).
      setMessages((prev) => {
        // find most recent plan message and mark it pending
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].kind === "plan") {
            setPendingPlanMsgId(prev[i].id);
            return prev;
          }
        }
        return prev;
      });
      return;
    }
    if (kind === "plan-discarded") {
      setPendingPlanMsgId(null);
      setMessages((prev) => [
        ...prev,
        { id: `s-${Date.now()}`, role: "system", text: "Plan discarded.", t: Date.now() },
      ]);
      return;
    }
    if (kind === "apply-complete") {
      // Mark the apply result message with the preSha so Revert is available.
      setPendingPlanMsgId(null);
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].kind === "apply") {
            next[i] = {
              ...next[i],
              preSha: payload.preSha,
              diffStat: payload.diffStat,
            };
            break;
          }
        }
        return next;
      });
      return;
    }
    if (kind === "revert-complete") {
      setMessages((prev) => [
        ...prev,
        { id: `r-${Date.now()}`, role: "system", text: `Reverted to checkpoint ${payload.sha.slice(0,7)}.`, t: Date.now() },
      ]);
      // Strip the preSha from the last apply message so Revert button hides
      setMessages((prev) => prev.map((m) =>
        m.preSha === payload.sha ? { ...m, preSha: null } : m
      ));
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
  }, [mode]);

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
      { id: `u-${Date.now()}`, role: "user", text: trimmed, mode, t: Date.now() },
    ]);
    ws.send(JSON.stringify({ type: "prompt", text: trimmed, mode }));
  }, [mode]);

  const MODE_DESCRIPTIONS = {
    strict: "Strict mode (Read · Grep · Glob). No web access at all — most private.",
    vault:  "Vault mode (Read · Grep · Glob · WebSearch). Local + search.",
    web:    "Web mode (WebFetch · WebSearch). No vault access — no exfil path.",
    apply:  "Apply mode (Plan → Apply with git checkpoint). Writes are scoped to the vault.",
  };

  /* Switching modes: the bridge resets its session on receipt of a prompt
     with a different mode, so context can't leak across. We also drop a
     system message in the transcript so the user sees the switch happened. */
  const switchMode = useCallback((next) => {
    if (!["strict", "vault", "web", "apply"].includes(next)) return;
    if (next === mode) return;
    setMode(next);
    setPendingPlanMsgId(null);
    setMessages((prev) => [
      ...prev,
      {
        id: `m-${Date.now()}`,
        role: "system",
        text: `Switched to ${MODE_DESCRIPTIONS[next]} Fresh session.`,
        mode: next,
        t: Date.now(),
      },
    ]);
  }, [mode]);

  const applyPlan = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "apply" }));
    setPendingPlanMsgId(null);
  }, []);

  const discardPlan = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "discard-plan" }));
  }, []);

  const revert = useCallback((sha) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "revert", sha }));
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
    mode,
    switchMode,
    pendingPlanMsgId,
    applyPlan,
    discardPlan,
    revert,
    sendPrompt,
    interrupt,
    setManualToken,
    retry,
  };
}
