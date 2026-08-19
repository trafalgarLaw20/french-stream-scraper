import { z } from "zod";

export const StreamSourceSchema = z.object({
  host: z.string().nullable(),
  url: z.string().url(),
  streamDirect: z.string().url().nullable(),
  label: z.string().nullable(),
});
export type StreamSource = z.infer<typeof StreamSourceSchema>;

export const MovieInfoSchema = z.object({
  url: z.string().url(),
  titre: z.string().nullable(),
  titreOriginal: z.string().nullable(),
  description: z.string().nullable(),
  annee: z.number().int().nullable(),
  dateSortie: z.string().nullable(),
  categories: z.array(z.string()).default([]),
  genres: z.array(z.string()).default([]),
  pays: z.array(z.string()).default([]),
  realisation: z.array(z.string()).default([]),
  acteurs: z.array(z.string()).default([]),
  duree: z.string().nullable(),
  note: z.number().nullable(),
  qualite: z.array(z.string()).default([]),
  version: z.array(z.string()).default([]),
  langue: z.array(z.string()).default([]),
  poster: z.string().url().nullable(),
  backdrop: z.string().url().nullable(),
  iframes: z.array(StreamSourceSchema).default([]),
  scrapedAt: z.string(),
});
export type MovieInfo = z.infer<typeof MovieInfoSchema>;

export interface FetcherOptions {
  headed?: boolean;
  timeoutMs?: number;
  userAgent?: string;
  cookieFile?: string;
  verbose?: boolean;
  onProgress?: ProgressFn;
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

export type ProgressFn = (event: ScrapeEvent) => void;

export interface ScrapeOptions extends FetcherOptions {
  resolveStreams?: boolean;
  out?: string;
  onProgress?: ProgressFn;
}

// ─── Séries ──────────────────────────────────────────────────────────────

export interface EpisodeInfo {
  number: number;
  version: string; // "vf" | "vostfr"
  title: string | null;
}

export interface SeasonLink {
  number: number | null;
  url: string;
  titre: string;
}

export interface SeriesInfo {
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
  seasonNumber: number | null; // numéro de la saison de CETTE page
  status: string | null; // "en cours" | "terminée" | null
  episodes: EpisodeInfo[]; // épisodes de cette saison
  otherSeasons: SeasonLink[]; // liens vers les autres saisons
  iframes: StreamSource[]; // iframes par défaut de la page (souvent vides pour une série)
  scrapedAt: string;
}

export type ScrapeResult = MovieInfo | SeriesInfo;
