# Market Dashboard

A local stock market dashboard: market overview, watchlist, single-stock detail and portfolio tracking.

## Run

```bash
npm run dev
```

Then open http://localhost:5173. For an optimized build, run `npm run build` and then `npm start`.

## How it works

- `server/index.js` is one Express server. It exposes `/api/*` (quotes, charts, search, movers, company profile)
  backed by Yahoo Finance through the `yahoo-finance2` package, with a short in-memory cache, and serves the
  React app (through Vite in development, from `dist/` in production).
- `src/` is the React + TypeScript frontend. Pages live in `src/pages`, shared pieces in `src/components`.
- The watchlist and portfolio holdings are stored in the browser's `localStorage`; nothing is saved on the server.

- The earnings calendar reads index membership (S&P 500, Nasdaq-100, Dow 30) from Wikipedia's component lists
  once a day, then takes each company's next earnings date from Yahoo Finance.

## Data caveats

Yahoo Finance's endpoints are unofficial: no API key is needed, quotes are typically delayed about 15 minutes,
and the endpoints can change without notice. All data access is in `server/index.js`, so swapping in another
provider only touches that file.
