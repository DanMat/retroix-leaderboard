/**
 * Retroix leaderboard — one multi-tenant Cloudflare Worker + D1 that backs the
 * high-score board for ALL Retroix games. Games are namespaced by `game`
 * (Retroix's gameId), so a new game needs no new infrastructure.
 *
 *   GET  /scores?game=<id>&limit=<n>   → top N rows (score desc)
 *   POST /scores  { game, initials, score, stage }  → insert one score
 *
 * Server-side validation + a hard score cap keep the anon-writable board honest
 * (the old direct-Supabase setup let anyone POST any score).
 */
export interface Env {
	DB: D1Database;
	/** Optional comma-separated allowlist of gameIds. Empty = allow any valid id. */
	ALLOWED_GAMES?: string;
	/** Optional hard cap on accepted scores (default 1,000,000,000). */
	MAX_SCORE?: string;
	/** Optional comma-separated allowed origins for CORS. Empty = "*". */
	ALLOWED_ORIGINS?: string;
}

const GAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/i;

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
	const allow = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
	const value = allow.length === 0 ? '*' : origin && allow.includes(origin) ? origin : allow[0];
	return {
		'Access-Control-Allow-Origin': value ?? '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin',
	};
}

function json(data: unknown, status: number, cors: Record<string, string>): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', ...cors },
	});
}

const toInt = (v: unknown, min: number, max: number): number => {
	const n = Math.floor(Number(v));
	if (!Number.isFinite(n)) return Number.NaN;
	return Math.min(max, Math.max(min, n));
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const cors = corsHeaders(env, request.headers.get('Origin'));

		if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
		if (url.pathname === '/') {
			return json({ ok: true, service: 'retroix-leaderboard' }, 200, cors);
		}

		// Registered games (those with at least one score) + quick stats.
		if (url.pathname === '/games' && request.method === 'GET') {
			const { results } = await env.DB.prepare(
				'SELECT game, COUNT(*) AS entries, MAX(score) AS topScore FROM scores GROUP BY game ORDER BY game',
			).all();
			return json(results ?? [], 200, cors);
		}

		// Every game's top-N in one response — powers the combined dashboard.
		if (url.pathname === '/leaderboards' && request.method === 'GET') {
			const limit = toInt(url.searchParams.get('limit') ?? '10', 1, 50) || 10;
			const { results } = await env.DB.prepare(
				`SELECT game, initials, score, stage, created_at FROM (
					SELECT game, initials, score, stage, created_at,
						ROW_NUMBER() OVER (PARTITION BY game ORDER BY score DESC, created_at ASC) AS rn
					FROM scores
				) WHERE rn <= ?1 ORDER BY game ASC, score DESC`,
			)
				.bind(limit)
				.all();
			const byGame: Record<string, unknown[]> = {};
			for (const r of (results ?? []) as Array<Record<string, unknown>>) {
				const key = String(r.game);
				(byGame[key] ??= []).push({
					initials: r.initials,
					score: r.score,
					stage: r.stage,
					created_at: r.created_at,
				});
			}
			return json(byGame, 200, cors);
		}

		if (url.pathname !== '/scores') return json({ error: 'not found' }, 404, cors);

		const allow = (env.ALLOWED_GAMES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
		const gameOk = (g: string) => GAME_RE.test(g) && (allow.length === 0 || allow.includes(g));
		const maxScore = Number(env.MAX_SCORE ?? '1000000000');

		// ── read top N ──────────────────────────────────────────────────────────
		if (request.method === 'GET') {
			const game = url.searchParams.get('game') ?? '';
			if (!gameOk(game)) return json({ error: 'invalid game' }, 400, cors);
			const limit = toInt(url.searchParams.get('limit') ?? '10', 1, 100) || 10;
			const { results } = await env.DB.prepare(
				'SELECT initials, score, stage, created_at FROM scores WHERE game = ?1 ORDER BY score DESC, created_at ASC LIMIT ?2',
			)
				.bind(game, limit)
				.all();
			return json(results ?? [], 200, cors);
		}

		// ── submit one score ────────────────────────────────────────────────────
		if (request.method === 'POST') {
			let body: Record<string, unknown>;
			try {
				body = (await request.json()) as Record<string, unknown>;
			} catch {
				return json({ error: 'bad json' }, 400, cors);
			}
			const game = String(body.game ?? '');
			if (!gameOk(game)) return json({ error: 'invalid game' }, 400, cors);

			const initials =
				String(body.initials ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'AAA';
			const score = toInt(body.score, 0, maxScore);
			if (!Number.isFinite(score)) return json({ error: 'invalid score' }, 400, cors);
			const stage = toInt(body.stage ?? 1, 1, 100000) || 1;

			await env.DB.prepare(
				'INSERT INTO scores (game, initials, score, stage) VALUES (?1, ?2, ?3, ?4)',
			)
				.bind(game, initials, score, stage)
				.run();
			return json({ ok: true }, 201, cors);
		}

		return json({ error: 'method not allowed' }, 405, cors);
	},
};
