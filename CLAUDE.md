# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Countdown + task dashboard for an academic submission (ARR Submission). Monorepo with an Express/MongoDB backend and a React/Vite frontend, deployed split across Railway (backend) and Vercel (frontend).

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
- `web/src/App.jsx` (~3500 lines) — **single-file application**. Contains all components, state, helpers, and rendering. No component files or separate modules.
- Routing: `window.location.pathname` checked directly — `/todo`, `/admin`, `/history`, or `/` (dashboard).
- Pages/components defined as functions within App.jsx: `DashboardPage`, `AdminPage`, `TodoComposerPage`, `HistoryPage`
- Data sync: fetches from API via `VITE_API_URL`, falls back to `localStorage` (`arr_dashboard_content_v1` key) as cache.
- `web/src/styles.css` (~36k lines) — all styles in one file.

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
- No router library — routing is a simple `window.location.pathname` switch in `App()`
- Backend uses ES modules (`"type": "module"` in package.json)
- Content normalization logic exists in both backend (`lib/content-schema.js`) and frontend (`App.jsx`) — keep them in sync when modifying the data schema
