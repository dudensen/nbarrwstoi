# Fantrax Cloudflare Starter

A React + Vite starter for a fantasy league site hosted on Cloudflare Pages, with:

- global season dropdown on every page
- Fantrax API proxy routes using Cloudflare Pages Functions
- public Google Sheets / CSV support for historical data
- orange + white theme
- basic pages for Home, Standings, Teams, Team Detail, Draft Picks, and History

## Included stack

- React
- Vite
- React Router
- Recharts
- Cloudflare Pages Functions

## Project structure

- `src/config/seasons.js` → all season IDs and spreadsheet references
- `functions/api/*.js` → Cloudflare proxy routes
- `src/context/SeasonContext.jsx` → global season state
- `src/pages/*` → site pages

## First thing to edit

Open `src/config/seasons.js` and replace the placeholder season IDs and spreadsheet IDs.

Also update `functions/api/_shared.js` with the same season IDs. In a larger production app, you would likely move that mapping to a shared generated file or KV/D1-backed config source.

## Local development

```bash
npm install
npm run dev
```

This runs the React app locally.

## Deploy to Cloudflare Pages

In Cloudflare Pages:

- Build command: `npm run build`
- Build output directory: `dist`

Keep the `functions/` folder at project root so Pages can detect the API routes.

## Example routes

- `/api/league-info?season=2025-26`
- `/api/standings?season=2025-26`
- `/api/rosters?season=2025-26`
- `/api/draft-picks?season=2025-26`
- `/api/spreadsheet?season=2025-26&kind=history`

## Notes

- Fantrax response shapes can vary, so the normalizers are intentionally defensive.
- The History page is generic on purpose. Replace it later with your exact spreadsheet rendering logic.
- If you want, the next step can be a more advanced version with team logos, charts, playoff brackets, transactions, and league-specific styling/content.
