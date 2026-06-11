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

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
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
  // Held in a ref so updateContent's closure doesn't capture stale state
  // across calls (callers can chain updates without setState batching
  // surprises).
  const contentRef = useRef(content);

  function setContent(next) {
    const value = typeof next === "function" ? next(contentRef.current) : next;
    contentRef.current = value;
    setContentState(value);
  }

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
    loadAndHydratePreferredContent().then((c) => {
      if (!mounted) return;
      contentRef.current = c;
      setContentState(c);
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
  // the latest. Lightweight stale-while-revalidate.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      loadAndHydratePreferredContent().then((c) => {
        // Only re-render if something actually differs — avoids a full
        // re-render every time the user alt-tabs.
        try {
          if (JSON.stringify(contentRef.current) === JSON.stringify(c)) return;
        } catch {
          // fall through and accept the new content
        }
        contentRef.current = c;
        setContentState(c);
      }).catch(() => {
        // network errors are fine — keep showing the cached doc
      });
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // Manual refresh — used by the /stats Sync Now flow which needs to
  // know exactly when fresh content has landed. Returns the fetched doc.
  const reloadContent = useCallback(async () => {
    const c = await loadAndHydratePreferredContent();
    contentRef.current = c;
    setContentState(c);
    return c;
  }, []);

  const value = {
    content,
    setContent,
    updateContent,
    reloadContent,
    loaded,
  };

  return <ContentCtx.Provider value={value}>{children}</ContentCtx.Provider>;
}

export function useContent() {
  const ctx = useContext(ContentCtx);
  if (!ctx) {
    throw new Error("useContent must be used inside <ContentProvider>");
  }
  return ctx;
}
