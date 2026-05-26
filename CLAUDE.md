# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Countdown + task dashboard for an academic submission (AAAI 2027, full-paper deadline 2026-07-28; originally built for ARR/EMNLP, pivoted 2026-05-22). Monorepo with an Express/MongoDB backend and a React/Vite frontend, deployed split across Railway (backend) and Vercel (frontend).

## Development Commands

### Backend (`backend/`)
```bash
cd backend && npm install    # install dependencies
npm run dev                  # start with --watch (port 4000)
npm run start                # production start
npm run migrate:content      # one-off schema migration script
```

### Frontend (`web/`)
```bash
cd web && npm install        # install dependencies
npm run dev                  # vite dev server (port 5173)
npm run build                # production build
npm run preview              # preview production build
```

### Root shortcuts
```bash
npm run dev:backend          # runs backend dev via --prefix
npm run dev:web              # runs web dev via --prefix
npm run build:web            # builds web via --prefix
```

## Architecture

### Monorepo layout
- `backend/` — Express 5 API (ES modules), connects to MongoDB Atlas
- `web/` — Vite + React 18 SPA, no router library (pathname-based routing)
- Root `package.json` has convenience scripts only; each sub-package manages its own dependencies

### Backend structure
- `backend/index.js` — Express server, all API routes defined inline. Lazy-connects to MongoDB on first request via `getCollection()`.
- `backend/lib/content-schema.js` — Schema version, normalization/validation logic, default content factories. This is the source of truth for data shape (currently `SCHEMA_VERSION = 2`). Auto-migrates on read: if `GET /api/content` detects the stored document differs from normalized form, it saves the normalized version automatically.
- `backend/scripts/migrate-content-v2.js` — Standalone migration script for bulk normalization.

### API endpoints
- `GET /api/health` — heartbeat
- `GET /api/content` — read (auto-migrates if schema changed)
- `PUT /api/content` — write (validates with `isContentPayload`, normalizes before save)
- `GET /api/content/schema` — schema version info
- `POST /api/content/migrate` — force migration

All content is stored as a single MongoDB document keyed by `CONTENT_KEY` (default `"main"`).

### Frontend structure
- `web/src/App.jsx` — routing shell + page definitions (`DashboardPage`, `AdminPage`, `HistoryPage`, `SettingsPage`). Routing is a `window.location.pathname` switch — `/`, `/todo`, `/admin`, `/history`, `/settings`. The `?focus=1` query on `/todo` auto-opens FocusMode. The `/todo` route renders the standalone `TodoPage` component from `components/todo/TodoPage.jsx`.
- `web/src/components/` — extracted UI:
  - `TopNav.jsx` — top nav (Dashboard / Tasks / Focus / Edit / History)
  - `WalkingFigure.jsx` — react-three-fiber 3D walker shown on the dashboard
  - `todo/TodoPage.jsx` — task page composition (renders Sidebar / SummaryBar / TaskList / DetailDrawer / TimerBar / FocusMode)
  - `todo/FocusMode.jsx` — full-screen focus overlay with themed parallax scenery (5 color schemes, 4 characters, 2 environments; settings persist to `localStorage`)
  - `todo/{Sidebar,SummaryBar,TaskList,TaskRow,DetailDrawer,TimerBar,InsightsPanel}.jsx`
- `web/src/hooks/` — `useTasks`, `usePomodoro`, `useTimer` (state + side-effect logic for the todo page)
- `web/src/utils/taskUtils.js` — shared task helpers, priority/recurrence constants, duration formatting
- `web/src/styles.css` — all styles in one file (large; refactor candidate)
- Data sync: fetches from API via `VITE_API_URL`, falls back to `localStorage` (`arr_dashboard_content_v1` key) as cache.

### Data model
Content schema (v2) has these top-level fields: `phase`, `projects`, `todaysTasks`, `todaysTasksDate`, `taskHistory`, `pomodoro`. Tasks have rich fields: priority, tags, due dates, recurrence, timer with sessions, pomodoro tracking. The normalization logic in `content-schema.js` (backend) is partially duplicated in `App.jsx` (frontend).

## Environment Variables

### Backend (`backend/.env`)
- `MONGODB_URI` (required) — Atlas connection string
- `MONGODB_DB` — default `dashboard_display`
- `MONGODB_COLLECTION` — default `dashboard_content`
- `CONTENT_KEY` — default `main`
- `CORS_ORIGINS` — comma-separated allowlist

### Frontend (`web/.env`)
- `VITE_API_URL` — backend base URL (e.g., `http://localhost:4000`)

## Deployment

- **Backend** → Railway: root directory `backend`, start command `npm run start`
- **Frontend** → Vercel: root directory `web`, build command `npm run build`, output `dist`
- `web/vercel.json` has SPA rewrites for `/admin`, `/history`, `/todo` routes

## Key Patterns

- No test framework, linter, or formatter is configured
- No router library — routing is a simple `window.location.pathname` switch in `App()`; query params (e.g., `?focus=1`) are read by destination components on mount
- Backend uses ES modules (`"type": "module"` in package.json)
- Content normalization logic exists in both backend (`lib/content-schema.js`) and frontend (`App.jsx`) — keep them in sync when modifying the data schema

## Session notes (2026-05-26): focus mode pomodoro overhaul

### Architecture decisions
- **Merged-timer model in focus mode**: work timer and pomodoro are linked via a single useEffect in `TodoPage.jsx` that watches `pomodoroRun.mode/status/taskId` and mirrors the task's work timer state. Work timer runs only when `mode === "focus" && status === "running"`; paused otherwise. Don't add competing logic in button onClicks — let the sync effect handle it.
- **Pomodoro state lives in `usePomodoro` hook only**, not persisted. On page reload, `pomodoroRun` is always `{ idle, focus, "" }`. FocusMode auto-starts on open via its own useEffect.
- **Auto-start defaults flipped to `true`** for `autoStartBreak` and `autoStartFocus` (both `content-schema.js` and `taskUtils.js`). Classic pomodoro continuous flow. Existing DB rows keep stored values; a one-off PUT is needed to update them.

### New patterns
- **Auto-adapt position math, not magic numbers**: `.focus-pomo-block` switches between center/right based on whether it would overlap the hiker, computed from `.focus-hiker` CSS (`bottom: 11%`, `height: 130px`) and the pomo block's transform. If hiker dimensions change, update the constants in the auto-adapt useEffect.
- **Cross-page state via URL query**: dashboard Focus button navigates `/todo?focus=1&taskId=X`. TodoPage reads on mount, opens focus, assigns task, then `replaceState`s the URL clean. Convention: assign only via URL, don't auto-start.
- **`focus_mode_settings` localStorage now holds UI preferences too** (Position selector, Show toggle, character/env/colorScheme) — pomodoro behavior settings stay in API content (focusMinutes, autoStartBreak, etc.).

### Bug fixes
- **localStorage merge clobber** (`taskUtils.js`, `loadAndHydratePreferredContent`): old logic did whole-document overwrite when local task timestamps beat remote, pushing stale `title`/`deadlineDate`/`projects` back to API. Fix: take local tasks but **always trust remote for config fields** (title, dates, phase, projects, pomodoro settings).
- **AudioContext autoplay**: completion chime silently failed (browser-suspended state). Fix: `if (ctx.state === "suspended") ctx.resume()` before scheduling oscillators. Replaced silent catch with `console.warn`.
- **Work-timer / pomodoro desync**: pomodoro transitions (focus→break) didn't pause work timer. User saw dark "rest" background but hiker still walked + clock kept counting. Fixed by TodoPage sync useEffect + `hikerWalking = isRunning && !isResting` as a belt-and-suspenders defense.
- **Parallax tile jolt** (ground + scenery): SVG content didn't tile at the wrap point. Fix: generate items in one half-tile width then duplicate at `x + tileWidth/2`. Mountain SVGs were already tile-able (verified math). Ground replaced with flat strip.
- **Mountain layers aligned-then-drifted-apart**: all four started at `translateX(0)`. Added `animation-delay: -27s/-37s/-38s` on back/mid/front (~25%/50%/75% phase offsets).

### Watch items
- **Pause sectioning under live test** (2026-05-26) — confirm break transitions work across multiple cycles.
- **Auto-start default flip affects existing DB rows**: one-off PUT done for Sheryl's production. Other hosts need the same PUT, or re-save settings via UI.
- **CSS geometry constants in `FocusMode.jsx` auto-adapt useEffect** must stay in sync with `.focus-hiker` CSS. Constants documented inline.
- **Scenery item counts halved** when adding tile-duplication (so on-screen total stays similar). Bump `count`/`rockCount` in SceneryLayer/DesertSceneryLayer if it feels sparse.
- **`components/WalkingFigure.jsx` is dead code** — fully built (3D character, confetti, head-tracking) but never imported. Decision (2026-05-26): leave for now, revisit post-AAAI.

### Next-session pickup
- **Compact CSS layout modes** (deferred): "strip across top" + "corner box" responsive modes for running the dashboard on a normal monitor without dedicating the small one. Pair with PowerToys Win+Ctrl+T for always-on-top until Tauri wrapper exists.
- **Forest theme distinctification** (deferred): make the visual concept legally distinct from Focus Traveller for safe public release. Directions sketched: ambient cycles (time/weather/seasons), per-session rewards, companion characters, biome unlocks.
- **Stale code from prior audit** (P2, not urgent): `useTimer.getTimerText` exported but never imported (4 inline reimplementations); `TimerBar` accepts `onPausePomodoro`/`onStartPomodoro` props but never binds them; `dashboard.html` at repo root is an unreferenced prototype with hardcoded "ARR Submission".
- **Dashboard inline-edit headings keyboard-accessible** (P0, trivial): `<span onClick>` for title/phase/deadline need `tabIndex`/`role="button"`/Enter handler.
- **Post-AAAI Store-abstraction refactor**: pluggable `IContentStore` (Mongo / JsonFile / ObsidianStore). Target August 2026. Spec at vault's `Areas/Personal/dashboard-app/integration-notes.md`.
