import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db } from "../pg/client";
import { scrapeRuns } from "../pg/schema/index";
import { discoverAll } from "../crawler/discover";
import { runPool } from "../crawler/pool";
import { queueStats } from "../pg/repos";

export type JobKind = "discover" | "metadata" | "stream" | "full-stream";

const WORKER_COUNT = Number(process.env.WORKER_COUNT ?? "2");
const STREAM_TOP_LIMIT = Number(process.env.STREAM_TOP_LIMIT ?? "100");

export interface JobResult {
  ok: boolean;
  total?: number;
  errors?: number;
  durationMs: number;
  message?: string;
}

async function logRunStart(kind: JobKind): Promise<number> {
  const [row] = await db
    .insert(scrapeRuns)
    .values({ kind, startedAt: new Date() })
    .returning({ id: scrapeRuns.id });
  return row.id;
}

async function logRunEnd(
  runId: number,
  patch: { total?: number; ok?: number; errors?: number; durationMs: number },
): Promise<void> {
  await db
    .update(scrapeRuns)
    .set({
      finishedAt: new Date(),
      total: patch.total,
      ok: patch.ok,
      errors: patch.errors,
      durationMs: patch.durationMs,
    })
    .where(eq(scrapeRuns.id, runId));
}

/**
 * Découverte du catalogue : parcourt /films/ et /series/ pour peupler url_queue.
 */
export async function runDiscover(): Promise<JobResult> {
  const started = Date.now();
  console.log("[job:discover] démarrage");
  try {
    const r = await discoverAll({ verbose: true });
    console.log(`[job:discover] ${r.totalFound} URLs découvertes`);
    return {
      ok: true,
      total: r.totalFound,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      message: (e as Error).message,
    };
  }
}

/**
 * Refresh métadonnées : remet tous les jobs 'done' en 'pending', puis lance le
 * pool en mode metadata-only (resolveStreams=false). Le repo upsertMovie skip
 * automatiquement les fiches dont le meta_hash est inchangé → gain d'I/O.
 */
export async function runMetadata(): Promise<JobResult> {
  const started = Date.now();
  console.log("[job:metadata] démarrage");
  try {
    const reset = await db.execute(sql`
      UPDATE url_queue SET status = 'pending' WHERE status = 'done'
    `);
    const resetCount = (reset as unknown as { rowCount?: number }).rowCount ?? 0;
    console.log(`[job:metadata] ${resetCount} jobs remis en pending`);

    const stats = await runPool({
      workerCount: WORKER_COUNT,
      resolveStreams: false,
      verbose: true,
    });
    console.log(
      `[job:metadata] ${stats.totalOk} ok, ${stats.totalSkipped} skipped, ${stats.totalErrors} erreurs`,
    );
    return {
      ok: stats.totalErrors === 0,
      total: stats.totalProcessed,
      errors: stats.totalErrors,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      message: (e as Error).message,
    };
  }
}

/**
 * Refresh streams des N fiches les plus populaires : remet les URLs
 * correspondantes en 'pending' puis lance le pool en mode full (resolveStreams).
 */
export async function runStreamTop(): Promise<JobResult> {
  const started = Date.now();
  console.log(`[job:stream] démarrage (limit=${STREAM_TOP_LIMIT})`);
  try {
    // Marque les N URLs des fiches les plus populaires comme 'pending'
    await db.execute(sql`
      WITH top AS (
        SELECT m.site_url
        FROM movies m
        WHERE m.deleted = false
        ORDER BY m.popularity DESC
        LIMIT ${STREAM_TOP_LIMIT}
      )
      UPDATE url_queue
      SET status = 'pending'
      FROM top
      WHERE url_queue.url = top.site_url
    `);
    console.log(`[job:stream] ${STREAM_TOP_LIMIT} URLs marquées pour refresh`);

    const stats = await runPool({
      workerCount: WORKER_COUNT,
      resolveStreams: true,
      verbose: true,
    });
    console.log(
      `[job:stream] ${stats.totalOk} ok, ${stats.totalErrors} erreurs`,
    );
    return {
      ok: stats.totalErrors === 0,
      total: stats.totalProcessed,
      errors: stats.totalErrors,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      message: (e as Error).message,
    };
  }
}

/**
 * Refresh complet (streams compris) de TOUT le catalogue. Très coûteux —
 * généralement programmé 1×/semaine (sam 04h00).
 */
export async function runFullStream(): Promise<JobResult> {
  const started = Date.now();
  console.log("[job:full-stream] démarrage");
  try {
    await db.execute(sql`UPDATE url_queue SET status = 'pending' WHERE status = 'done'`);

    const stats = await runPool({
      workerCount: WORKER_COUNT,
      resolveStreams: true,
      verbose: true,
    });
    console.log(
      `[job:full-stream] ${stats.totalOk} ok, ${stats.totalErrors} erreurs`,
    );
    return {
      ok: stats.totalErrors === 0,
      total: stats.totalProcessed,
      errors: stats.totalErrors,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      message: (e as Error).message,
    };
  }
}

/** Map job kind → fonction. */
export const JOB_RUNNERS: Record<JobKind, () => Promise<JobResult>> = {
  discover: runDiscover,
  metadata: runMetadata,
  stream: runStreamTop,
  "full-stream": runFullStream,
};

export { logRunStart, logRunEnd, queueStats };
