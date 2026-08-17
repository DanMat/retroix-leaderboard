-- Retroix leaderboard — one table, multi-tenant by `game` (Retroix gameId).
CREATE TABLE IF NOT EXISTS scores (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	game       TEXT    NOT NULL,
	initials   TEXT    NOT NULL,
	score      INTEGER NOT NULL,
	stage      INTEGER NOT NULL DEFAULT 1,
	created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Fast "top N for a game" reads.
CREATE INDEX IF NOT EXISTS idx_scores_game_rank
	ON scores (game, score DESC, created_at ASC);
