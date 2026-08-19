import { sql } from "drizzle-orm";
import { db } from "../client";
import { urlQueue } from "../schema/index";

export interface ClaimedJob {
  id: number;
  url: string;
  kind: "movie" | "series" | "episode" | null;
  attempts: number;
}

const MAX_ATTEMPTS = 5;

/**
 * Réclame le prochain job en attente.
 * Utilise SELECT ... FOR UPDATE SKIP LOCKED pour permettre à plusieurs workers
 * de réclamer en parallèle sans collision.
 */
export async function claimNext(): Promise<ClaimedJob | null> {
  return await db.transaction(async (tx) => {
    const result = (await tx.execute(sql`
      SELECT id, url, kind, attempts
      FROM url_queue
      WHERE status = 'pending' AND attempts < ${MAX_ATTEMPTS}
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `)) as unknown as { rows: Array<{ id: number; url: string; kind: string | null; attempts: number }> };

    if (!result.rows || result.rows.length === 0) return null;
    const job = result.rows[0];

    await tx.execute(sql`
      UPDATE url_queue
      SET status = 'running', last_run_at = now()
      WHERE id = ${job.id}
    `);

    return {
      id: Number(job.id),
      url: String(job.url),
      kind: (job.kind ?? null) as ClaimedJob["kind"],
      attempts: Number(job.attempts),
    };
  });
}

export async function markDone(id: number): Promise<void> {
  await db.execute(sql`
    UPDATE url_queue SET status = 'done', last_run_at = now()
    WHERE id = ${id}
  `);
}

export async function markError(id: number, message: string): Promise<void> {
  await db.execute(sql`
    UPDATE url_queue
    SET status = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN 'error' ELSE 'pending' END,
        attempts = attempts + 1,
        last_error = ${message.slice(0, 500)},
        last_run_at = now()
    WHERE id = ${id}
  `);
}

export async function queueStats(): Promise<{
  pending: number;
  running: number;
  done: number;
  error: number;
  stale: number;
}> {
  const result = (await db.execute(sql`
    SELECT status, count(*)::int AS n FROM url_queue GROUP BY status
  `)) as unknown as { rows: Array<{ status: string; n: number }> };
  const out = { pending: 0, running: 0, done: 0, error: 0, stale: 0 };
  for (const r of result.rows) {
    if (r.status in out) (out as Record<string, number>)[r.status] = r.n;
  }
  return out;
}

/** Remet les jobs `running` trop anciens en `pending` (workers crashés). */
export async function resetStale(timeoutMs = 30 * 60 * 1000): Promise<number> {
  const result = (await db.execute(sql`
    UPDATE url_queue
    SET status = 'pending'
    WHERE status = 'running' AND last_run_at < now() - (${timeoutMs} / 1000 || ' seconds')::interval
    RETURNING id
  `)) as unknown as { rows: unknown[] };
  return result.rows.length;
}
