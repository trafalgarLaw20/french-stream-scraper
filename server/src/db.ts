import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MovieInfo } from "../../src/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../data/history.sqlite");

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    titre TEXT,
    annee INTEGER,
    poster TEXT,
    backdrop TEXT,
    scrapedAt TEXT NOT NULL,
    json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_history_titre ON history(titre);
  CREATE INDEX IF NOT EXISTS idx_history_scrapedAt ON history(scrapedAt DESC);
`);

export interface HistoryRow {
  id: string;
  url: string;
  titre: string | null;
  annee: number | null;
  poster: string | null;
  backdrop: string | null;
  scrapedAt: string;
  json: string;
}

export function insertMovie(id: string, movie: MovieInfo): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO history (id, url, titre, annee, poster, backdrop, scrapedAt, json)
    VALUES (@id, @url, @titre, @annee, @poster, @backdrop, @scrapedAt, @json)
  `);
  stmt.run({
    id,
    url: movie.url,
    titre: movie.titre,
    annee: movie.annee,
    poster: movie.poster,
    backdrop: movie.backdrop,
    scrapedAt: movie.scrapedAt,
    json: JSON.stringify(movie),
  });
}

export function listHistory(query?: string, limit = 100): HistoryRow[] {
  if (query && query.trim()) {
    const stmt = db.prepare(`
      SELECT * FROM history
      WHERE titre LIKE @q OR url LIKE @q
      ORDER BY scrapedAt DESC LIMIT @limit
    `);
    return stmt.all({ q: `%${query.trim()}%`, limit }) as HistoryRow[];
  }
  const stmt = db.prepare(`SELECT * FROM history ORDER BY scrapedAt DESC LIMIT @limit`);
  return stmt.all({ limit }) as HistoryRow[];
}

export function getHistoryById(id: string): HistoryRow | undefined {
  const stmt = db.prepare(`SELECT * FROM history WHERE id = ?`);
  return stmt.get(id) as HistoryRow | undefined;
}

export function deleteHistoryById(id: string): boolean {
  const stmt = db.prepare(`DELETE FROM history WHERE id = ?`);
  return stmt.run(id).changes > 0;
}

export function rowToMovie(row: HistoryRow): MovieInfo {
  return JSON.parse(row.json) as MovieInfo;
}

export { db };
