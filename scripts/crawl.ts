/**
 * CLI : lance le worker pool pour vider url_queue.
 *
 * Usage :
 *   npx tsx scripts/crawl.ts [--worker-count N] [--resolve-streams] [--max-items N] [--verbose]
 *
 * Exemples :
 *   npm run crawl -- --max-items 3 --verbose              # test sur 3 fiches
 *   npm run crawl -- --worker-count 2                      # 2 workers, mode metadata
 *   npm run crawl -- --worker-count 2 --resolve-streams    # 2 workers, mode full
 */
import "dotenv/config";
import { runPool } from "../crawler/pool";
import { queueStats, resetStale } from "../pg/repos";
import { pgPool } from "../pg/client";

const args = process.argv.slice(2);
function argValue(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

const workerCount = Number(argValue("worker-count") ?? process.env.WORKER_COUNT ?? "2");
const maxItems = argValue("max-items") ? Number(argValue("max-items")) : undefined;
const resolveStreams = args.includes("--resolve-streams");
const verbose = args.includes("--verbose") || args.includes("-v");

if (!Number.isFinite(workerCount) || workerCount < 1) {
  console.error("--worker-count doit être un entier ≥ 1");
  process.exit(2);
}

async function main(): Promise<void> {
  // Reset stale jobs au cas où un précédent run aurait laissé des "running"
  const reset = await resetStale();
  if (reset > 0) console.error(`[crawl] ${reset} jobs 'running' remis en 'pending'`);

  const before = await queueStats();
  console.error(`[crawl] État initial:`, before);
  console.error(
    `[crawl] Démarrage : workers=${workerCount} maxItems=${maxItems ?? "∞"} resolveStreams=${resolveStreams}`,
  );

  const result = await runPool({
    workerCount,
    maxItems,
    resolveStreams,
    verbose,
    onItemStart: (job, wid) => {
      console.error(`[w${wid}] → ${job.kind ?? "movie"} #${job.id} ${job.url}`);
    },
    onItemDone: (job, wid, durationMs, skipped) => {
      const sk = skipped ? " (skipped, meta inchangée)" : "";
      console.error(`[w${wid}] ✓ #${job.id} en ${Math.round(durationMs / 1000)}s${sk}`);
    },
    onItemError: (job, wid, err) => {
      console.error(`[w${wid}] ✗ #${job.id} ${job.url}: ${err.message}`);
    },
  });

  console.log("\n=== RÉSULTATS ===");
  console.log(JSON.stringify(result, null, 2));

  const after = await queueStats().catch(() => null);
  if (after) {
    console.error(`[crawl] État final:`, after);
  }
  await pgPool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
