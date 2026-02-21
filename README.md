# Dashboard Display

Countdown + task dashboard with:
- React/Vite frontend (`web/`)
- Express + MongoDB backend (`backend/`)
- Deploy split across Vercel (web) and Railway (backend)

## Repository Structure

```txt
dashboard-display/
  backend/   # Express API + MongoDB
  web/       # Vite + React app
```

## What Was Added

- Backend API with MongoDB persistence:
  - `GET /api/health`
  - `GET /api/content`
  - `PUT /api/content`
- Frontend sync to API via `VITE_API_URL` with localStorage fallback/cache
- Vercel SPA rewrites for direct routes (`/admin`, `/history`) in `web/vercel.json`
- Monorepo split so Railway deploys only `backend/` and Vercel deploys only `web/`

## Prerequisites

- Node.js 18+
- npm
- MongoDB Atlas database (recommended)

## Local Development

### 1) Backend

```bash
cd backend
cp .env.example .env
# Fill in MONGODB_URI and other values
npm install
npm run dev
```

Backend runs on `http://localhost:4000` by default.

### 2) Frontend

```bash
cd web
cp .env.example .env
# Set VITE_API_URL=http://localhost:4000
npm install
npm run dev
```

Frontend runs on `http://localhost:5173` by default.

### 3) Optional root helper commands

From repo root:

```bash
npm run dev:backend
npm run dev:web
npm run build:web
```

## Environment Variables

### Backend (`backend/.env`)

- `MONGODB_URI` required Atlas connection string
- `MONGODB_DB` default `dashboard_display`
- `MONGODB_COLLECTION` default `dashboard_content`
- `CONTENT_KEY` default `main`
- `CORS_ORIGINS` comma-separated allowlist (recommended in production)

Example:

```env
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster-url>/<db-name>?retryWrites=true&w=majority
MONGODB_DB=dashboard_display
MONGODB_COLLECTION=dashboard_content
CONTENT_KEY=main
CORS_ORIGINS=https://your-app.vercel.app,http://localhost:5173
```

### Frontend (`web/.env`)

- `VITE_API_URL` backend base URL

Example:

```env
VITE_API_URL=http://localhost:4000
```

## Deploy

### Railway (Backend)

1. Create Railway project from this repo.
2. Set **Root Directory** to `backend`.
3. Start command: `npm run start`.
4. Add backend env vars (`MONGODB_URI`, `MONGODB_DB`, `MONGODB_COLLECTION`, `CONTENT_KEY`, `CORS_ORIGINS`).
5. Deploy and copy backend URL (example `https://your-api.up.railway.app`).

### Vercel (Frontend)

1. Import same repo in Vercel.
2. Set **Root Directory** to `web`.
3. Build command `npm run build`, output directory `dist`.
4. Set env var: `VITE_API_URL=https://your-api.up.railway.app`.
5. Redeploy.

## Route Rewrites (Vercel)

`web/vercel.json` rewrites:
- `/admin/:path*` -> `/`
- `/history/:path*` -> `/`

This prevents direct-load `404: NOT_FOUND` on these SPA routes.

## Verify It Is Using MongoDB

1. In browser DevTools Network tab, confirm:
   - `GET <VITE_API_URL>/api/content` on load
   - `PUT <VITE_API_URL>/api/content` on save/admin actions
2. In Atlas Data Explorer, confirm document changes in:
   - DB: `dashboard_display`
   - Collection: `dashboard_content`
   - Doc key: `main`
3. Clear local cache and reload:
   - `localStorage.removeItem("arr_dashboard_content_v1")`
   - If data remains, it came from MongoDB/API.

## API Contract

### `GET /api/health`

Returns service heartbeat.

### `GET /api/content`

Response:

```json
{
  "content": { "...": "..." } | null,
  "updatedAt": "ISO_DATE" | null
}
```

### `PUT /api/content`

Request body must include:
- `phase` string
- `todaysTasks` array
- `todaysTasksDate` string
- `taskHistory` array

Response:

```json
{
  "ok": true,
  "updatedAt": "ISO_DATE"
}
```

## Notes

- Root `.env` is not used after the split.
- Keep secrets out of git. `.env` files are ignored.
