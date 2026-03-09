# Deploy Guide

This repo is now split:
- `backend/` -> Railway
- `web/` -> Vercel

## 1) Deploy API to Railway

1. Create a Railway project from this repo.
2. Set **Root Directory** to:
   `backend`
3. In service settings, set Start Command to:
   `npm run start`
4. Add environment variables:
   - `MONGODB_URI` (MongoDB Atlas connection string)
   - `MONGODB_DB=dashboard_display`
   - `MONGODB_COLLECTION=dashboard_content`
   - `CONTENT_KEY=main`
   - `CORS_ORIGINS=https://<your-vercel-domain>`
5. Deploy and copy your Railway public URL (example `https://your-api.up.railway.app`).

## 2) Deploy Frontend to Vercel

1. Import this same repo into Vercel.
2. Set **Root Directory** to:
   `web`
3. Keep build settings as Vite defaults (`npm run build`, output `dist`).
4. Add Vercel environment variable:
   - `VITE_API_URL=https://<your-railway-domain>`
5. Redeploy.

## 3) Route Rewrites

`web/vercel.json` is included and rewrites:
- `/admin/*` -> `/`
- `/history/*` -> `/`
- `/todo/*` -> `/`

This fixes direct-load 404s on those pages.

## 4) Local Development

1. Backend:
   - copy `backend/.env.example` to `backend/.env`
   - run `npm install` (inside `backend/`)
   - run `npm run dev`
   - optional migration: `npm run migrate:content`
2. Frontend:
   - copy `web/.env.example` to `web/.env` and set `VITE_API_URL`
   - run `npm install` (inside `web/`)
   - run `npm run dev`

Root `.env` is no longer used after the split.
