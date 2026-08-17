# retroix-leaderboard

One small **Cloudflare Worker + D1** that backs the high-score leaderboard for
**every** [Retroix](https://github.com/DanMat/Retroix) game. Games are namespaced by
`game` (Retroix's `gameId`), so a new game needs **no new infrastructure** — just a new
id. Replaces the old Supabase backend; free at hobby scale and it never sleeps.

**Live:** https://retroix-leaderboard.danmat.workers.dev

## API

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| `GET` | `/scores?game=<id>&limit=<n>` | — | `[{ initials, score, stage, created_at }]`, score desc |
| `POST` | `/scores` | `{ game, initials, score, stage }` | `{ ok: true }` (201) |

CORS is open (`*`) by default so any game page can use it. Server-side it validates the
`game` id, uppercases + trims `initials` to 3 letters, and **clamps `score` to a hard
cap** — so the board can't be spammed with garbage (the old anon-key Supabase POST couldn't).

## Point a Retroix game at it

```js
var board = Retroix.leaderboard({
  gameId: 'blastix',
  apiUrl: 'https://retroix-leaderboard.danmat.workers.dev',
});
```

Leave `apiUrl` off for a local (per-browser) board; Supabase config still works too.

## Setup / redeploy

```bash
pnpm install
pnpm run db:create      # one-time: create the D1 database (copy the id into wrangler.toml)
pnpm run db:init        # one-time: apply schema.sql to the remote DB
pnpm run deploy         # deploy the Worker
```

Optional hardening in `wrangler.toml` `[vars]`: `ALLOWED_GAMES` (allowlist), `MAX_SCORE`,
`ALLOWED_ORIGINS` (lock CORS).

## Cost

Free tier: Workers 100k req/day, D1 5 GB + millions of reads/day. A game leaderboard
stays comfortably free; only a viral hit would reach the $5/mo Workers plan.
