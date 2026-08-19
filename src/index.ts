import { launchFetcher, fetchPage, closeFetcher } from "./fetcher.js";
import { parseMovie } from "./parser.js";
import { collectPlayers } from "./players.js";
import { resolveStreams } from "./resolver.js";
import { MovieInfoSchema } from "./schema.js";
import type { MovieInfo, ScrapeOptions, SeriesInfo } from "./schema.js";
import { parseSeries } from "../parser/series.js";

export async function scrapeMovie(url: string, opts: ScrapeOptions = {}): Promise<MovieInfo> {
  const onProgress = opts.onProgress;
  onProgress?.({ type: "start", url });
  const { browser } = await launchFetcher(opts);
  try {
    const fetched = await fetchPage(url, browser, opts);

    const playerIframes = await collectPlayers(fetched.page, {
      timeoutMs: opts.timeoutMs,
      verbose: opts.verbose,
      onProgress,
    }).catch((e: unknown) => {
      console.error(`[scrape] collectPlayers échoué: ${(e as Error).message}`);
      return [];
    });

    const info = parseMovie(fetched.html, fetched.url, playerIframes);
    onProgress?.({ type: "parse:done" });

    if (opts.resolveStreams !== false && info.iframes.length > 0) {
      info.iframes = await resolveStreams(browser, info.iframes, {
        timeoutMs: opts.timeoutMs,
        verbose: opts.verbose,
        onProgress,
      });
    }

    const validated = MovieInfoSchema.safeParse(info);
    if (!validated.success) {
      throw new Error(`Schéma invalide: ${JSON.stringify(validated.error.flatten())}`);
    }
    onProgress?.({ type: "done", movie: validated.data });
    return validated.data;
  } catch (e) {
    onProgress?.({ type: "error", message: (e as Error).message });
    throw e;
  } finally {
    await closeFetcher(browser);
  }
}

/**
 * Scrape une page série.
 *
 * En MVP :
 *   - récupère les métadonnées (titre, poster, description…)
 *   - liste les épisodes de la saison courante (data-num + data-type)
 *   - liste les liens vers les autres saisons
 *   - NE résout PAS les streams directs des épisodes (champ iframes probablement vide)
 *
 * La résolution des streams d'épisodes nécessite un clic par épisode et sera
 * traitée dans un sprint ultérieur (mode "episode-stream-resolution").
 *
 * Note : `resolveStreams` est ignoré pour les séries en MVP.
 */
export async function scrapeSeries(url: string, opts: ScrapeOptions = {}): Promise<SeriesInfo> {
  const onProgress = opts.onProgress;
  onProgress?.({ type: "start", url });
  const { browser } = await launchFetcher(opts);
  try {
    const fetched = await fetchPage(url, browser, opts);

    // Pour une série, on ne collecte PAS les iframes dynamiques via collectPlayers :
    // sur le thème actuel, les .player-option correspondent aux épisodes et le clic
    // chargerait le player du 1er épisode seulement, en bruyant. On se contente des
    // iframes statiques de la page (souvent vides pour une série).
    const info = parseSeries(fetched.html, fetched.url);
    onProgress?.({ type: "parse:done" });

    // TODO Sprint 4+ : résolution des streams par épisode (clic sur chaque .episode-row).
    onProgress?.({
      type: "done",
      movie: info as unknown as MovieInfo, // hack typage — le frontend séries viendra plus tard
    });
    return info;
  } catch (e) {
    onProgress?.({ type: "error", message: (e as Error).message });
    throw e;
  } finally {
    await closeFetcher(browser);
  }
}

export { MovieInfoSchema } from "./schema.js";
export { parseSeries, detectSeries } from "../parser/series.js";
export type {
  MovieInfo,
  SeriesInfo,
  EpisodeInfo,
  SeasonLink,
  StreamSource,
  ScrapeOptions,
  FetcherOptions,
  ScrapeEvent,
  ProgressFn,
  ScrapeResult,
} from "./schema.js";
