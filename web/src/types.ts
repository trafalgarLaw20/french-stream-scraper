export interface StreamSource {
  host: string | null;
  url: string;
  streamDirect: string | null;
  label: string | null;
}

export type LangueCode = "VOSTFR" | "VF-FR" | "VF-QC" | "DEFAUT" | "AUTRE";

export interface LangueInfo {
  code: LangueCode;
  libelle: string;
  drapeau: string;
}

export interface MovieInfo {
  url: string;
  titre: string | null;
  titreOriginal: string | null;
  description: string | null;
  annee: number | null;
  dateSortie: string | null;
  categories: string[];
  genres: string[];
  pays: string[];
  realisation: string[];
  acteurs: string[];
  duree: string | null;
  note: number | null;
  qualite: string[];
  version: string[];
  langue: string[];
  poster: string | null;
  backdrop: string | null;
  iframes: StreamSource[];
  scrapedAt: string;
}

export type ScrapeEvent =
  | { type: "start"; url: string }
  | { type: "fetch:start"; url: string }
  | { type: "fetch:cf"; title: string }
  | { type: "fetch:retry" }
  | { type: "fetch:done"; finalUrl: string }
  | { type: "players:start"; count: number }
  | { type: "players:click"; player: string }
  | { type: "iframe:found"; url: string; host: string | null; label: string | null }
  | { type: "players:done"; total: number }
  | { type: "parse:done" }
  | { type: "resolve:start"; url: string; host: string | null }
  | { type: "resolve:candidate"; url: string }
  | { type: "resolve:done"; url: string; streamDirect: string | null }
  | { type: "resolve:all:done" }
  | { type: "done"; movie: MovieInfo }
  | { type: "error"; message: string; stage?: string };

export interface HistoryItem {
  id: string;
  url: string;
  titre: string | null;
  annee: number | null;
  poster: string | null;
  backdrop: string | null;
  scrapedAt: string;
}

export interface JobSummary {
  id: string;
  url: string;
  status: "pending" | "running" | "done" | "error";
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  result: MovieInfo | null;
}

// ─── Admin (PostgreSQL) ─────────────────────────────────────────────────

export type JobKind = "discover" | "metadata" | "stream" | "full-stream";

export interface QueueStats {
  pending: number;
  running: number;
  done: number;
  error: number;
  stale: number;
}

export interface AdminStatus {
  currentJob: JobKind | null;
  queue: QueueStats;
  staleReset: number;
}

export interface ScrapeRun {
  id: number;
  kind: JobKind;
  startedAt: string;
  finishedAt: string | null;
  total: number | null;
  ok: number | null;
  errors: number | null;
  durationMs: number | null;
}

// ─── Catalogue (PostgreSQL) ─────────────────────────────────────────────

export interface MovieListItem {
  id: number;
  titre: string | null;
  annee: number | null;
  poster: string | null;
  backdrop: string | null;
  note: number | null;
  duree: string | null;
  popularity: number;
}

export interface MovieDetail extends MovieListItem {
  siteUrl: string;
  titreOriginal: string | null;
  description: string | null;
  dateSortie: string | null;
  langue: string[] | null;
  qualite: string[] | null;
  version: string[] | null;
  categories: string[] | null;
  firstScrapedAt: string;
  lastMetaAt: string | null;
  lastStreamAt: string | null;
  genres: { id: number; name: string }[];
  acteurs: { id: number; name: string }[];
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

// ─── Séries (catalogue PG) ──────────────────────────────────────────────

export interface SeriesListItem {
  id: number;
  titre: string | null;
  annee: number | null;
  poster: string | null;
  backdrop: string | null;
  note: number | null;
  status: string | null;
  popularity: number;
}

export interface SeriesDetail extends SeriesListItem {
  siteUrl: string;
  titreOriginal: string | null;
  description: string | null;
  genres: { id: number; name: string }[];
  episodeCount: number;
  firstScrapedAt: string;
  lastMetaAt: string | null;
}

export interface EpisodeListItem {
  id: number;
  number: number;
  titre: string | null;
  description: string | null;
  duree: string | null;
  airDate: string | null;
}

// ─── Streams (PG) ───────────────────────────────────────────────────────

export interface StreamSourcePG {
  id: number;
  host: string | null;
  iframeUrl: string;
  label: string | null;
  lastSeen: string;
  direct: StreamDirectPG[];
}

export interface StreamDirectPG {
  sourceId: number;
  url: string;
  protocol: "hls" | "mp4" | null;
  expiresAt: string | null;
}

// ─── Facets ─────────────────────────────────────────────────────────────

export interface GenreFacet {
  id: number;
  name: string;
  count: number;
}

export interface YearFacet {
  annee: number;
  count: number;
}

export type SortKey = "recent" | "popular" | "title" | "year";
