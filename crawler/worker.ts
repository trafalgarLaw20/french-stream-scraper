import { scrapeMovie, scrapeSeries } from "../src/index";
import {
  claimNext,
  markDone,
  markError,
  upsertMovie,
  upsertSeries,
  type ClaimedJob,
} from "../pg/repos";

export interface WorkerOptions {
  workerId: number;
  resolveStreams?: boolean;
  verbose?: boolean;
  /** Si fourni, stoppe après ce nombre d'items traités (test). */
  maxItems?: number;
  onItemStart?: (job: ClaimedJob, workerId: number) => void;
  onItemDone?: (
    job: ClaimedJob,
    workerId: number,
    durationMs: number,
    skipped: boolean,
  ) => void;
  onItemError?: (job: ClaimedJob, workerId: number, err: Error) => void;
}

export interface WorkerStats {
  processed: number;
  ok: number;
  errors: number;
  skipped: number;
  durationMs: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Boucle worker : réclame et traite des jobs jusqu'à épuisement de la queue.
 * Chaque appel à scrapeMovie/scrapeSeries lance et ferme son propre browser
 * Playwright — P workers en parallèle = P browsers en pic (consommation x P).
 */
export async function runWorker(opts: WorkerOptions): Promise<WorkerStats> {
  const started = Date.now();
  let processed = 0;
  let ok = 0;
  let errors = 0;
  let skipped = 0;

  while (true) {
    if (opts.maxItems !== undefined && processed >= opts.maxItems) break;

    const job = await claimNext();
    if (!job) break;

    processed++;
    const itemStart = Date.now();
    opts.onItemStart?.(job, opts.workerId);

    try {
      if (job.kind === "series") {
        const info = await scrapeSeries(job.url, { verbose: opts.verbose });
        const res = await upsertSeries(info);
        if (res.skipped) skipped++;
      } else {
        // Défaut = movie (kind null traité comme movie)
        const info = await scrapeMovie(job.url, {
          resolveStreams: opts.resolveStreams,
          verbose: opts.verbose,
        });
        const res = await upsertMovie(info);
        if (res.skipped) skipped++;
      }
      await markDone(job.id);
      ok++;
      opts.onItemDone?.(job, opts.workerId, Date.now() - itemStart, false);

      // Petit délai anti-ban entre 2 jobs (1-2 s)
      await sleep(1000 + Math.random() * 1000);
    } catch (e) {
      const err = e as Error;
      errors++;
      opts.onItemError?.(job, opts.workerId, err);
      await markError(job.id, err.message);

      // Backoff plus long en cas d'erreur (potentiellement CF)
      await sleep(5000 + Math.random() * 5000);
    }
  }

  return { processed, ok, errors, skipped, durationMs: Date.now() - started };
}
