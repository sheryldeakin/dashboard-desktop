# Session Log: 2026-06-03 17:52 - home-redesign-chat-bridge

## Quick Reference (for AI scanning)
**Confidence keywords:** /home redesign, sidebar, chat drawer, dashboard-chat-bridge, Apply mode, plan-apply, git checkpoint, mergeHeartbeats, dailyTop3 rollover, import-claude-sessions segmentation, project colors palette, Top 3 task auto-promotion, useTick worker, Vercel password protection, /remote-control, ChatsCard, claude.ai/code

**Projects:** dashboard-desktop (Vercel frontend + Railway backend), dashboard-chat-bridge (local Node WS bridge — standalone repo), second_brain vault (Obsidian + sync scripts), Sprouting Prints, 3D Printing, Dashboard App

**Outcome:** /home reshaped into a real todo-app surface (sidebar, two-column main+rail with Today snapshot strip + project-colored stats); local Claude bridge built then deprecated in favor of Anthropic-hosted /remote-control links; Top 3 slots auto-promote into real tasks with bidirectional sync; project-color regression fully closed (migration + auto-color in scripts).

## Decisions Made
- **Drop the embedded chat bridge for now, keep code for future API-key-based distribution.** Custom bridge had too much attack surface for the value vs Anthropic-hosted UI; revisit when shipping to others as a product.
- **Replace bridge UI with a Chats rail card holding user-pasted claude.ai/code remote-control URLs.** Stored in localStorage (per-device), inline +/✎/× management. Anyone-who-loads-/home can click them, so gating the dashboard is a prerequisite (Vercel Password Protection recommended).
- **Time-segmented attribution > share-based split** in `import-claude-sessions.py`. One workSession entry per contiguous same-project run within a burst, with its own start/end. Toggleable via `DEFAULTS["segmented"]`.
- **Project colors stored permanently, not just rendered.** One-shot migration backfilled 7 default-colored projects with palette colors; both scripts (`import-claude-sessions.py`, `sync-todos.py`) now auto-pick unused palette slots for new projects.
- **Top 3 slots become real tasks.** Auto-create on first text edit, tagged `#top-3` + `from-YYYY-MM-DD`. Bidirectional sync (slot ↔ task). Clearing slot text un-links but doesn't delete the task.
- **Sidebar layout: primary nav top, system actions (Display/Edit/Settings) bottom-pinned with hairline separator.** Width: `clamp(220px, 17vw, 300px)`. Matches Linear/Things/Todoist pattern.
- **Apply mode for safe writes (plan/apply two-phase + git checkpoint + audit log)**. Built into bridge with 4 modes (Strict/Vault/Web/Apply). Bridge code preserved post-deprecation.
- **Cap main column at 680px reading width** even with fluid outer spacing — `/home` content doesn't sprawl on ultrawide monitors.
- **`mergeHeartbeats` per-key newest-timestamp-wins**, not naive object-spread. Closed a stale-snapshot clobber where long-open `/home` tabs were reverting fresh script heartbeats.
- **Frontend lazy-rollover for dailyTop3** + script-side skip-when-no-daily-note. Both fix needed because either path alone wipes carried Top 3 items.
- **Hooks before early returns** — bitten once by adding `useHeartbeatRows()` after `if (!loaded) return`; React error #310. Memory: `hooks-before-early-return.md`.
- **Never test PUTs against production with sparse bodies** — bitten once, wiped 69 todaysTasks + 7 projects + 2 taskHistory. Restored from 5:30 PM backup. Memory: `never-test-puts-against-production.md`.
- **No AI attribution in commits** — user explicitly forbade Co-Authored-By trailers; rules saved to both user-level CLAUDE.md and project CLAUDE.md.

## Key Learnings
- **`/remote-control` is one-directional** — only claude.ai/code and Claude mobile app can connect; no public WS/HTTP for third-party UIs. Known bugs as of early 2026: idle-archive at 10-15 min, sessions disappearing from list, etc. (GitHub issues #31487, #30691, #28402, #32651).
- **iframes of claude.ai are hard-blocked** via X-Frame-Options + CSP `frame-src 'self'`. Two redundant layers; no proxy/CSS workaround from a web page.
- **HTTPS Vercel → ws://localhost requires PNA headers** — Chrome blocks fetch+WebSocket from HTTPS pages to local IPs without `Access-Control-Allow-Private-Network: true` + standard CORS. Bridge needed CORS middleware echoing the origin.
- **Windows TIME_WAIT blocks Node rebind on 127.0.0.1** with default SO_EXCLUSIVEADDRUSE for 60-120s. Either wait or use a different port for immediate restart.
- **Main-thread `setInterval` is throttled in unfocused windows on Chrome/Edge** (~1Hz or worse). Web Worker–driven ticks don't get throttled the same way → used to fix Focus mode timer freezing on the small monitor. Memory: `unfocused-window-timer-throttling.md`.
- **The pomodoro setInterval also DECREMENTS state per tick** (vs computing from wall-clock startedAt), so it actually loses real time when throttled — not just display freshness. Known unfixed bug, deferred.
- **CSS `clamp(min, preferred-with-vw, max)`** is the modern way to do responsive spacing — no media queries needed for padding/gap/width. Use rem + vw together for accessibility/zoom support.
- **8-point grid (4/8/12/16/24/32/48)** is the canonical SaaS spacing scale (Material Design, used by Linear/Things/Todoist). Internal rhythm fixed; outer chrome scales via clamp.
- **claude.ai Max subscription auth includes a `user:sessions:claude_code` scope** — confirms the spawned `claude` CLI uses your subscription, not metered API. `total_cost_usd` in stream-json output is API-equivalent for transparency, not actual billing.
- **The June 15 2026 billing change** gave Pro/Max plans a dedicated Agent SDK credit pool for headless `claude -p` usage, separate from interactive limits.
- **`/admin` route uses a Vercel rewrite to `/`** (SPA routing); 404s on a stale tab post-deploy = hash mismatch because Vite asset filenames rotate per build.
- **mergeHeartbeats wasn't enough** — needed per-key timestamp comparison; naive spread let stale snapshots overwrite fresh values.
- **claude.ai/code sessions don't appear in the app unless remote-control is enabled** — `/config` → "Enable Remote Control for all sessions" → true is the global toggle. Once enabled, all new sessions register automatically.

## Solutions & Fixes
- **Project color migration** (one-shot Python): round-trip GET → modify `projects[i].color` for any with default `#b66e35` → PUT back. Same palette as frontend project-mix fallback so colors are consistent app-wide.
- **`mergeHeartbeats` fix**:
  ```js
  function mergeHeartbeats(existing, incoming) {
    const e = existing && typeof existing === "object" ? existing : {};
    const i = incoming && typeof incoming === "object" ? incoming : {};
    const out = { ...e };
    for (const [key, val] of Object.entries(i)) {
      const iMs = isoToMs(val);
      if (iMs === null) continue;
      const eMs = isoToMs(out[key]);
      if (eMs === null || iMs > eMs) out[key] = val;
    }
    return out;
  }
  ```
- **dailyTop3 rollover** in `HomePage.jsx`: lazy useEffect on load that detects `dailyTop3.date != today`, pushes old to history, resets to fresh slots. Plus defensive `date: todayKey()` stamp on every `updateSlot`/`handleCarry` patch body.
- **sync-top3 skip-when-no-note**: if today's daily note doesn't exist, write heartbeat and exit — don't reconcile (treating missing vault as "empty" wiped app values).
- **useTick(enabled)` hook + tick-worker.js**: Web Worker posts `Date.now()` every 1s, hook subscribes, FocusMode re-renders. Workers aren't throttled in unfocused windows.
- **Top 3 → task auto-promote**: in `updateSlot`, if `slot.text && !slot.promotedTaskId`, create task via `createDefaultTask` with `tags=["top-3", "from-YYYY-MM-DD"]`, store id on slot, append to `todaysTasks`. Bidirectional reconcile via useEffect that runs on `content.todaysTasks` changes.
- **CORS / PNA on bridge**:
  ```js
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  ```
- **Bridge security 8 layers**: localhost-only bind, single-use /pair, pair token, origin allowlist (CORS + WS upgrade), mode separation (vault/web/strict/apply), tool whitelist (no Bash/Edit/Write), filesystem whitelist via --add-dir, rate limit (20 prompts/min/connection).
- **Apply mode plan/apply**: `claude -p ... --allowedTools "Read,Grep,Glob"` for plan phase → user clicks Apply → `git -C <vault> commit --allow-empty -m "checkpoint: ..."` for snapshot → `claude -p ... --allowedTools "Read,Grep,Glob,Edit,Write" --permission-mode acceptEdits --resume <sessionId>` for execute. Revert button does `git reset --hard <preSha>`.
- **Segmented attribution** in `import-claude-sessions.py`: walk events in time order, attribute each (file mode → cwd fallback → inherit previous), group consecutive same-project, merge segments shorter than 90s into longer neighbor.
- **Auto-color new projects** in both vault scripts: track used palette colors among current projects, pick first unused palette slot, fall back to cycle.

## Files Modified

### Dashboard repo (`C:\Users\Sheryl\Desktop\Projects\dashboard-desktop`)
- `web/src/components/HomePage.jsx`: massive — Top3Editor with task linkage + Focus link + timer dot; useTodayStats hook with projectMix palette; new components (TodaySnapshot, RightNowCard, ProjectMixCard, HourRibbonCard, CountdownCard, ScheduleBanner, ScheduleHealthCard, PeakHourCard, UpNextCard, ChatsCard); SnapshotPill; ChatDrawer (added then removed); lazy-rollover useEffect; updateSlot with auto-promote.
- `web/src/components/StatsPage.jsx`: project-color resolution + palette fallback; BreakdownBars/ClaudeProjectRows/ProjectTaskSplit/ProjectGridCard now use row.color; URL query for `?tab=today`.
- `web/src/components/SideNav.jsx` (new): two-group nav (primary + system).
- `web/src/components/ChatDrawer.jsx` (created then deleted): chat UI for local bridge.
- `web/src/hooks/useChatBridge.js` (created then deleted): WS connection + mode + plan/apply flow.
- `web/src/hooks/useTick.js` (new): Worker-backed tick.
- `web/src/workers/tick-worker.js` (new): posts Date.now() every 1s.
- `web/src/components/todo/FocusMode.jsx`: wired `useTick()` to fix unfocused-window freeze.
- `web/src/components/todo/Sidebar.jsx`: added Top 3 section icon.
- `web/src/utils/taskUtils.js`: TODO_SIDEBAR_SECTIONS has new "top3" entry; taskMatchesSidebarSection handles "top3" before inTodayQueue early-out.
- `web/src/styles.css`: app-shell + side-nav (wider, bottom-grouped), home-layout (two-column grid with clamp), home-today-snapshot (4-cell hairline grid, clickable to /stats?tab=today), home-rail-card family, home-top3-* (timer dot + Focus link), home-projmix-*, home-hour-ribbon, home-chats-*, stats-project-dot, removed ~440 lines of chat drawer CSS.
- `web/src/App.jsx`: /home uses app-shell layout with SideNav.
- `backend/index.js`: mergeHeartbeats per-key timestamp-newest; isoToMs hoisted above use.
- `backend/lib/content-schema.js`: SCHEMA_VERSION still 3 (no field additions).
- `CLAUDE.md`: added "Commits and public artifacts" section forbidding AI attribution.

### Bridge repo (`C:\Users\Sheryl\Projects\dashboard-chat-bridge`) — kept for future revival
- `package.json`, `bridge.js`, `auth.js`, `claude-runner.js`, `git-checkpoint.js`, `audit-log.js`
- `README.md`, `SECURITY.md` (full threat model + hardening options)
- `.gitignore`, `.token` (gitignored, contains pair token)

### Vault scripts (`C:\Users\Sheryl\Documents\second_brain\System\scripts`)
- `import-claude-sessions.py`: added rules (Sprouting Prints, Mindstorm, 3D Printing, Dashboard App, PhD Advisors/Documents); switched to time-segmented attribution; auto-color for new projects.
- `sync-top3.py`: defensive defense against missing daily note (skips dailyTop3 reconcile, heartbeat-only); handles app-date-mismatch with content gracefully.
- `sync-todos.py`: auto-color for new projects via shared palette helper.

### User-level config (`C:\Users\Sheryl\.claude`)
- `CLAUDE.md` (new): user-level no-AI-attribution rule (applies across all projects).

### Memory files (`C:\Users\Sheryl\.claude\projects\C--Users-Sheryl-Desktop-Projects-dashboard-desktop\memory`)
- `MEMORY.md`: updated index
- `hooks-before-early-return.md` (new)
- `unfocused-window-timer-throttling.md` (new)
- `no-ai-attribution-in-commits.md` (new)
- `never-test-puts-against-production.md` (new)
- `dailytop3-rollover-traps.md` (new)
- `option-b-chat-link-registry.md` (new — full deferred design)
- `import-claude-segmentation.md` (new — design + reprocessing recipe)

## Setup & Config
- **Bridge runs at**: `C:\Users\Sheryl\Projects\dashboard-chat-bridge\` via `npm start` (Node 18+, deps express + ws). Localhost:4100, pair token in `.token`.
- **Vault is a git repo** at `C:\Users\Sheryl\Documents\second_brain` with hourly auto-backup commits. Used as the checkpoint base for Apply mode.
- **Vercel production URL**: `https://dashboard-desktop.vercel.app` (production), regex allowlist `dashboard-desktop[\w.-]*\.vercel\.app`.
- **Railway backend**: `https://dashboard-desktop-production.up.railway.app/api/content`.
- **claude CLI path**: `C:\Users\Sheryl\.local\bin\claude.exe` (v2.1.161+).
- **Python path** (for scheduled tasks — MUST be absolute): `C:\Users\Sheryl\AppData\Local\Programs\Python\Python310\python.exe`.
- **Subscription**: Claude Max OAuth, scope includes `user:sessions:claude_code` (subscription auth, not API key).
- **Scheduled tasks**: DashboardSyncTop3 (5min), DashboardSyncTodos (15min), DashboardImportClaude (60min), DashboardBackup (daily). All use absolute python path.
- **`/config` setting**: "Enable Remote Control for all sessions" = true (now). All new claude sessions auto-register at claude.ai/code.

## Pending Tasks
- **Push commits to remote** — many local commits not pushed yet (sidebar, Top 3 task linkage, project colors, segmentation, mergeHeartbeats fix). User does push manually.
- **Enable Vercel Password Protection** on production deployment before pinning real session URLs in Chats card. Settings → Deployment Protection → Password.
- **Option B chat-link registry** (deferred per memory note) — backend `/chat/:label` redirect endpoints + local wrapper script. Build when manual URL maintenance becomes annoying.
- **Pomodoro decrement bug** — usePomodoro.js still decrements `remainingSeconds` by 1 per setInterval tick instead of computing from wall-clock startedAt. Loses real time when throttled. Refactor when it becomes a real complaint.
- **Bridge revival as API-key version** — for future distribution to other users (current bridge uses subscription auth which can't be redistributed per Anthropic ToS).
- **Inbox + AAAI Submission both sage-toned** — minor color clash from migration; user can re-color Inbox in `/admin` if it bothers them.
- **Historical workSession reprocessing** — old data uses share-split timestamps; would need state-file reset + production data wipe to retroactively segment. Recipe in `import-claude-segmentation.md`.
- **Cloudflare Access** as a better long-term auth than Vercel password — free for personal use, real SSO.

## Errors & Workarounds
- **Production data wipe via sparse PUT body** — I sent `{phase:'foo', todaysTasks:[], scheduledTaskHeartbeats:{test-min:...}}` for debugging. Backend's normalize filled missing fields with defaults; lost phase, 69 todaysTasks, 7 projects (→ 1), 2 taskHistory. Restored from `dashboard_2026-06-02_1730.json` backup. Memory rule: never test PUTs against production with sparse bodies.
- **React error #310** after adding useHeartbeatRows() AFTER the !loaded early return. First render (loading) had 6 hooks; second render (loaded) had 8 hooks; hook-count mismatch crashes. Fix: move all hook calls above the early return; rely on `?.` in the hook for safe pre-load behavior.
- **EADDRINUSE on bridge restart** — Windows TIME_WAIT holds port 60-120s after `Stop-Process`. Wait or use a different PORT env var.
- **CORS error in browser** (`No 'Access-Control-Allow-Origin' header is present`) — bridge was started before I added CORS code; needed restart to pick up the new code.
- **404 on Vercel asset (`index-CP_UckYQ.js`)** — stale HTML cache after deploy; Vite hashes rotate. Hard refresh (Ctrl+Shift+R).
- **Top 3 carried items disappeared 10 min after carry** — two compounding bugs: frontend kept stale `dailyTop3.date` on edits + sync-top3 treated missing daily note as empty vault and wrote empty back. Fixed both; memory: `dailytop3-rollover-traps.md`.
- **Browser extension noise in console** — `contentscript.js` MaxListenersExceeded, `ObjectMultiplex` warnings = MetaMask/wallet extension. Unrelated to app.
- **Bridge `import { WebSocketServer } from "node:ws"`** — `ws` is an npm package, not a Node built-in. Fixed to `from "ws"`.
- **Sprouting Prints session being attributed to "Second Brain"** — no attribution rule for the project path. Added rules; new sessions attribute correctly via longest-prefix-match.

## Key Exchanges
- Early: user feedback that Cormorant Garamond serif looked wrong; pivot to system sans-serif + SaaS-style uppercase section labels.
- Mid: user rejected my four "next move" options as "not helping make it look like a todo app/dashboard" → led to the two-column main+rail restructure (which DID land).
- Late: user asked if /remote-control could replace the bridge — confirmed yes for the "general chat" use case, leading to bridge deprecation. Bridge code preserved for API-key version later.
- User explicitly forbade AI attribution in commits — first I tried to rewrite git history (used filter-branch which also rewrote backup branch via `--all`, then recovered via `refs/original/`); user said "leave it" so I reset locally and saved the rule to user-level + project CLAUDE.md.
- Iterative UI work on /home: header re-anchor → drop borders + serif labels → revert serif → color tokens → spacing scale → two-column layout → section dividers → today snapshot strip → snapshot strip reformat (4-cell grid with hairlines) → whole-strip-clickable.
- "is there anywhere else on the stats page we should be using these project colors?" → led to stats-wide color rollout.

---

## Quick Resume Context
The dashboard `/home` is now a proper todo-app surface: stable "Today" header, two-column main (Top 3 + carryover) + rail (countdown / right-now / project-mix / hour-ribbon / peak-hour / up-next / chats / schedule-health), all with project-color awareness. Top 3 slots auto-promote into real tasks tagged `#top-3` with full timer/focus/history support, visible as a new ★ Top 3 section in the `/todo` sidebar. The custom local chat bridge was built (8-layer security, plan/apply mode with git checkpoint) but deprecated in favor of Anthropic-hosted `/remote-control` URLs pinned to a Chats rail card; bridge code preserved at `C:\Users\Sheryl\Projects\dashboard-chat-bridge\` for future API-key-based distribution. Critical data-integrity fixes: mergeHeartbeats per-key timestamp wins, dailyTop3 lazy-rollover, sync-top3 skip-when-no-note. Pending: push everything, enable Vercel Password Protection before pinning real session URLs.
