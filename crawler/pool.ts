import { runWorker, type WorkerOptions, type WorkerStats } from "./worker";

export interface PoolOptions extends Omit<WorkerOptions, "workerId"> {
  workerCount: number;
}

export interface PoolStats {
  totalProcessed: number;
  totalOk: number;
  totalErrors: number;
  totalSkipped: number;
  durationMs: number;
  perWorker: WorkerStats[];
}

/**
 * Lance `workerCount` workers en parallèle, chacun bouclant sur url_queue
 * jusqu'à épuisement.
 *
 * Note : ne ferme PAS le pool PG — c'est l'appelant qui en décide
 * (script CLI vs scheduler Fastify en daemon).
 */
export async function runPool(opts: PoolOptions): Promise<PoolStats> {
  const started = Date.now();
  const workerOpts = (workerId: number): WorkerOptions => ({
    workerId,
    resolveStreams: opts.resolveStreams,
    verbose: opts.verbose,
    maxItems: opts.maxItems,
    onItemStart: opts.onItemStart,
    onItemDone: opts.onItemDone,
    onItemError: opts.onItemError,
  });

  const perWorker = await Promise.all(
    Array.from({ length: opts.workerCount }, (_, i) => runWorker(workerOpts(i + 1))),
  );

  return {
    totalProcessed: perWorker.reduce((s, r) => s + r.processed, 0),
    totalOk: perWorker.reduce((s, r) => s + r.ok, 0),
    totalErrors: perWorker.reduce((s, r) => s + r.errors, 0),
    totalSkipped: perWorker.reduce((s, r) => s + r.skipped, 0),
    durationMs: Date.now() - started,
    perWorker,
  };
}
