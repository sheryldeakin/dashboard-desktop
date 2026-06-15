/* ContentContext — single owner of the content document for the whole
   app. Pages used to each call loadAndHydratePreferredContent on mount,
   which meant a fresh /api/content GET per nav click (on top of the
   bundle re-eval from full page reloads). Now that we use SPA nav via
   react-router, the page components stay mounted briefly between routes
   and re-mount fresh on the next visit — so a per-page loader still
   fired on every nav, wasting the SPA win.

   ContentProvider loads once on App mount, holds the content, and
   exposes:
     - content     the current document (or DEFAULT_CONTENT until loaded)
     - setContent  raw setter (use for purely local React state moves)
     - updateContent(updater)  set + persist in one call; preferred path
                               for any mutation that should hit the DB
     - reloadContent()  force a fresh fetch (for the /stats sync flow)
     - loaded      false until first fetch resolves; pages should gate
                   their "real" UI behind this so we don't flash empty
                   state.

   Cross-tab freshness: when the tab becomes visible again, we
   background-refetch. So if you make a change in another browser tab,
   coming back to this one updates it without a manual reload. The fetch
   only updates state if the doc actually differs (cheap JSON.stringify
   compare — note this is the *whole* doc; cost is acceptable because it
   only runs on visibility change, not per render). */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CONTENT,
  cloneContent,
  loadContent,
  loadAndHydratePreferredContent,
  persistContent as persistContentRaw,
  applyDailyRollover,
} from "../utils/taskUtils.js";

const ContentCtx = createContext(null);

export function ContentProvider({ children }) {
  // Synchronous localStorage read so first paint shows the user's last
  // known content instead of the hardcoded DEFAULT_CONTENT seed. The
  // async loadAndHydrate effect below still runs to pull fresh from the
  // API. Marks `loaded=true` only once that resolves, so pages can
  // distinguish "showing cached fallback" from "showing fresh data".
  const [content, setContentState] = useState(() => loadContent() ?? cloneContent(DEFAULT_CONTENT));
  const [loaded, setLoaded] = useState(() => loadContent() !== null);
  // apiOnline tracks whether the most recent GET succeeded. true on
  // happy path; flips to false when a fetch rejects (network down,
  // backend crashed, MongoServerSelectionError, etc.). UI badges read
  // this to show a small offline indicator. PUT failures aren't yet
  // wired in (they're fire-and-forget inside persistContent); good
  // followup if writes silently failing becomes a recurring pain.
  const [apiOnline, setApiOnline] = useState(true);
  // Held in a ref so updateContent's closure doesn't capture stale state
  // across calls (callers can chain updates without setState batching
  // surprises).
  const contentRef = useRef(content);

  // useCallback so consumers passing setContent to memo'd children don't
  // bust memoization on every provider render.
  const setContent = useCallback((next) => {
    const value = typeof next === "function" ? next(contentRef.current) : next;
    contentRef.current = value;
    setContentState(value);
  }, []);

  // updateContent: idiomatic "mutate + persist" path. Pass a function
  // (prev) => next; we set and PUT in one go. Skips persistence if the
  // updater returns the same reference (no-op).
  const updateContent = useCallback((updater) => {
    setContentState((prev) => {
      const next = updater(prev);
      if (next === prev) return prev;
      contentRef.current = next;
      persistContentRaw(next);
      return next;
    });
  }, []);

  // Initial load: same flow each page used to do on its own.
  useEffect(() => {
    let mounted = true;
    loadAndHydratePreferredContent()
      .then((c) => {
        if (!mounted) return;
        contentRef.current = c;
        setContentState(c);
        setLoaded(true);
        setApiOnline(true);
      })
      .catch((err) => {
        if (!mounted) return;
        console.warn("Initial content load failed:", err?.message);
        setApiOnline(false);
        // Still mark loaded so the UI doesn't sit on a skeleton
        // forever; we fall back to whatever's in localStorage cache.
        setLoaded(true);
      });
    return () => { mounted = false; };
  }, []);

  // Daily rollover heartbeat — moved from the legacy DashboardPage so
  // rollover applies app-wide regardless of which route is mounted. Every
  // 60s we check if today's date has changed and roll if so.
  useEffect(() => {
    const id = window.setInterval(() => {
      setContentState((prev) => {
        const { content: rolled, changed } = applyDailyRollover(prev);
        if (changed) {
          contentRef.current = rolled;
          persistContentRaw(rolled);
          return rolled;
        }
        return prev;
      });
    }, 60000);
    return () => window.clearInterval(id);
  }, []);

  // Visibility-change refresh: when the tab becomes active again, pull
  // the latest. Lightweight stale-while-revalidate. Also flips
  // apiOnline depending on whether the refresh succeeded — so the
  // offline badge clears once connectivity returns + a tab focus
  // triggers the next fetch.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      loadAndHydratePreferredContent()
        .then((c) => {
          setApiOnline(true);
          // Only re-render if something actually differs — avoids a full
          // re-render every time the user alt-tabs.
          try {
            if (JSON.stringify(contentRef.current) === JSON.stringify(c)) return;
          } catch {
            // fall through and accept the new content
          }
          contentRef.current = c;
          setContentState(c);
        })
        .catch((err) => {
          console.warn("Visibility-change refresh failed:", err?.message);
          setApiOnline(false);
        });
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // Manual refresh — used by the /stats Sync Now flow which needs to
  // know exactly when fresh content has landed. Returns the fetched doc.
  const reloadContent = useCallback(async () => {
    try {
      const c = await loadAndHydratePreferredContent();
      contentRef.current = c;
      setContentState(c);
      setApiOnline(true);
      return c;
    } catch (err) {
      setApiOnline(false);
      throw err;
    }
  }, []);

  // Memoize the context value so consumers only re-render when content or
  // loaded actually change — not when an unrelated parent re-renders.
  const value = useMemo(
    () => ({ content, setContent, updateContent, reloadContent, loaded, apiOnline }),
    [content, setContent, updateContent, reloadContent, loaded, apiOnline],
  );

  return <ContentCtx.Provider value={value}>{children}</ContentCtx.Provider>;
}

export function useContent() {
  const ctx = useContext(ContentCtx);
  if (!ctx) {
    throw new Error("useContent must be used inside <ContentProvider>");
  }
  return ctx;
}
