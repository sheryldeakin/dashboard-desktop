# Deploy Guide

## 1) Deploy API to Railway

1. Create a Railway project from this repo.
2. In service settings, set Start Command to:
   `npm run start`
3. Add environment variables:
   - `MONGODB_URI` (MongoDB Atlas connection string)
   - `MONGODB_DB=dashboard_display`
   - `MONGODB_COLLECTION=dashboard_content`
   - `CONTENT_KEY=main`
   - `CORS_ORIGINS=https://<your-vercel-domain>`
4. Deploy and copy your Railway public URL.

## 2) Deploy Frontend to Vercel

1. Import this same repo into Vercel.
2. Keep build settings as Vite defaults (`npm run build`, output `dist`).
3. Add Vercel environment variable:
   - `VITE_API_URL=https://<your-railway-domain>`
4. Redeploy.

## 3) Route Rewrites

`vercel.json` is included and rewrites:
- `/admin/*` -> `/`
- `/history/*` -> `/`

This fixes direct-load 404s on those pages.
