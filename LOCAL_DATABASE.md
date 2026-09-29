# Leaderboard storage

The leaderboard needs **no external services and no npm packages**.

```bash
npm start          # serves the game and the API on http://localhost:8000
```

## Storage backends

`server/store.js` picks the backend at startup:

| Backend | When | File |
| --- | --- | --- |
| SQLite (`node:sqlite`) | Node 22.5+ (before 22.13 it needs `--experimental-sqlite`) | `data/flattenhund.db` |
| JSON file | Anything else, or `FLATTENHUND_STORE=json` | `data/flattenhund.json` (written atomically) |

`npm start` used to crash on Node without `node:sqlite` (`ERR_UNKNOWN_BUILTIN_MODULE`); it now logs a one-line notice and uses the JSON store instead. The schema lives in [server/schema.sql](server/schema.sql) and is applied on startup. A new database is seeded with `DEV` (100) and `TEST` (50). `data/` is gitignored; delete it to reset the board.

Environment: `PORT` (default 8000), `HOST` (default 0.0.0.0), `DATA_DIR` (default `./data`).

## API

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/api/health` | | `{ ok, backend }` |
| GET | `/api/leaderboard?limit=10` | | `[{ name, score }]`, best first (limit 1-100) |
| POST | `/api/scores` | `{ name, score, character }` | `201` new player, `200` existing; only replaces a lower score |
| POST | `/api/sessions` | `{ character, isNightMode }` | session row |
| PATCH | `/api/sessions/:id` | `{ score, boostUsedCount }` | `{ updated: true }` or `404` |

Validation: names are trimmed, stripped of control characters and cut to 10 characters; scores must be integers from 0 to 100000; bodies are capped at 10 KB; writes are limited to 40 per minute per IP (`429`). Only `index.html`, `style.css`, `manifest.json`, `sw.js`, `assets/`, `css/` and `js/` are served, so the database, server code and `package.json` are not downloadable.

## Client behaviour (`js/local-db.js`)

`window.gameDB` exposes `getLeaderboard`, `saveScore`, `createGameSession`, `updateGameSession`, `isAvailable`, `isOnline`, `mode` and `init`.

- On load it pings `/api/health` with a 2.5 s timeout. Success means `mode === 'online'`.
- If the server is unreachable (static hosting, server stopped, network drop) it switches to `mode === 'local'`: the board is kept in `localStorage` (top 50) and every save is also queued (last 20).
- While local it re-checks the server at most every 15 s. When it answers, the queue is flushed and the board goes back online.
- The UI labels the board `ONLINE LEADERBOARD` or `LOCAL LEADERBOARD` accordingly.
