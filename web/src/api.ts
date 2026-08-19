import type {
  AdminStatus,
  EpisodeListItem,
  GenreFacet,
  HistoryItem,
  JobKind,
  JobSummary,
  MovieDetail,
  MovieInfo,
  MovieListItem,
  Paginated,
  ScrapeRun,
  SeriesDetail,
  SeriesListItem,
  StreamSourcePG,
  YearFacet,
} from "./types.js";

const base = "/api";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${text}`.trim());
  }
  return (await res.json()) as T;
}

function adminToken(): string | null {
  return localStorage.getItem("adminToken") || null;
}

function adminHeaders(): Record<string, string> {
  const t = adminToken();
  return t ? { "X-Admin-Token": t } : {};
}

export const api = {
  scrape(url: string, opts: { resolveStreams?: boolean; timeoutMs?: number } = {}): Promise<{ jobId: string }> {
    return jsonFetch(`${base}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, ...opts }),
    });
  },

  batch(urls: string[], opts: { resolveStreams?: boolean; delayMs?: number } = {}): Promise<{ jobIds: string[] }> {
    return jsonFetch(`${base}/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls, ...opts }),
    });
  },

  job(jobId: string): Promise<JobSummary> {
    return jsonFetch(`${base}/jobs/${jobId}`);
  },

  history(query?: string): Promise<{ items: HistoryItem[] }> {
    const q = query ? `?q=${encodeURIComponent(query)}` : "";
    return jsonFetch(`${base}/history${q}`);
  },

  historyItem(id: string): Promise<MovieInfo> {
    return jsonFetch(`${base}/history/${id}`);
  },

  deleteHistory(id: string): Promise<{ ok: boolean }> {
    return jsonFetch(`${base}/history/${id}`, { method: "DELETE" });
  },

  exportUrl(id: string, format: "json" | "csv" = "json"): string {
    return `${base}/export/${id}?format=${format}`;
  },

  // ─── Admin ─────────────────────────────────────────────────────────
  adminStatus(): Promise<AdminStatus> {
    return jsonFetch(`${base}/admin/status`, { headers: adminHeaders() });
  },

  adminCrawl(kind: JobKind): Promise<{ ran: boolean; message?: string; reason?: string }> {
    return jsonFetch(`${base}/admin/crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ kind }),
    });
  },

  adminRuns(limit = 20): Promise<{ runs: ScrapeRun[] }> {
    return jsonFetch(`${base}/admin/runs?limit=${limit}`, { headers: adminHeaders() });
  },

  // ─── Catalogue ─────────────────────────────────────────────────────
  catalogMovies(opts: { cursor?: string; limit?: number; genre?: string; year?: number; q?: string } = {}): Promise<Paginated<MovieListItem>> {
    const params = new URLSearchParams();
    if (opts.cursor) params.set("cursor", opts.cursor);
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.genre) params.set("genre", opts.genre);
    if (opts.year) params.set("year", String(opts.year));
    if (opts.q) params.set("q", opts.q);
    const qs = params.toString();
    return jsonFetch(`${base}/m/movies${qs ? "?" + qs : ""}`);
  },

  catalogMovie(id: number): Promise<MovieDetail> {
    return jsonFetch(`${base}/m/movies/${id}`);
  },

  catalogMovieStreams(id: number): Promise<{ streams: StreamSourcePG[] }> {
    return jsonFetch(`${base}/m/movies/${id}/streams`);
  },

  refreshMovieStreams(id: number): Promise<{ started: boolean; reason?: string }> {
    return jsonFetch(`${base}/m/movies/${id}/refresh`, { method: "POST" });
  },

  movieRefreshStatus(id: number): Promise<{
    running: boolean;
    startedAt: number | null;
    finishedAt: number | null;
    ok: boolean | null;
    error: string | null;
    cooldown: boolean;
  }> {
    return jsonFetch(`${base}/m/movies/${id}/refresh`);
  },

  catalogSeries(opts: { cursor?: string; limit?: number; q?: string } = {}): Promise<Paginated<SeriesListItem>> {
    const params = new URLSearchParams();
    if (opts.cursor) params.set("cursor", opts.cursor);
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.q) params.set("q", opts.q);
    const qs = params.toString();
    return jsonFetch(`${base}/m/series${qs ? "?" + qs : ""}`);
  },

  catalogSeriesDetail(id: number): Promise<SeriesDetail> {
    return jsonFetch(`${base}/m/series/${id}`);
  },

  catalogSeriesEpisodes(id: number): Promise<{ items: EpisodeListItem[] }> {
    return jsonFetch(`${base}/m/series/${id}/episodes`);
  },

  catalogGenres(): Promise<{ items: GenreFacet[] }> {
    return jsonFetch(`${base}/m/genres`);
  },

  catalogYears(): Promise<{ items: YearFacet[] }> {
    return jsonFetch(`${base}/m/years`);
  },

  search(q: string, opts: { kind?: "all" | "movie" | "series"; limit?: number } = {}): Promise<{
    items: Array<{ kind: "movie" | "series"; id: number; titre: string | null; annee: number | null; poster: string | null }>;
  }> {
    const params = new URLSearchParams({ q });
    if (opts.kind) params.set("kind", opts.kind);
    if (opts.limit) params.set("limit", String(opts.limit));
    return jsonFetch(`${base}/m/search?${params.toString()}`);
  },
};
