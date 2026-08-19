import "dotenv/config";
import cron from "node-cron";
import { JOB_RUNNERS, logRunEnd, logRunStart, type JobKind } from "./jobs";

let currentJob: JobKind | null = null;

/** Job en cours (ou null si idle). Exposé pour l'API admin. */
export function getCurrentJob(): JobKind | null {
  return currentJob;
}

/**
 * Exécute un job en exclusivité mutuelle : si un autre job tourne déjà,
 * on log + skip. Le mutex est global au process.
 */
export async function runJobExclusive(kind: JobKind): Promise<{
  ran: boolean;
  reason?: string;
}> {
  if (currentJob) {
    console.log(`[scheduler] skip ${kind}: ${currentJob} déjà en cours`);
    return { ran: false, reason: `${currentJob} déjà en cours` };
  }

  currentJob = kind;
  const runId = await logRunStart(kind);
  const started = Date.now();
  console.log(`[scheduler] démarrage job "${kind}" (run #${runId})`);

  try {
    const runner = JOB_RUNNERS[kind];
    const result = await runner();
    await logRunEnd(runId, {
      total: result.total,
      ok: result.ok ? result.total : 0,
      errors: result.errors,
      durationMs: Date.now() - started,
    });
    console.log(
      `[scheduler] "${kind}" terminé en ${Math.round((Date.now() - started) / 1000)}s`,
    );
    return { ran: true };
  } catch (e) {
    const msg = (e as Error).message;
    await logRunEnd(runId, { errors: 1, durationMs: Date.now() - started });
    console.error(`[scheduler] "${kind}" échoué:`, msg);
    return { ran: true, reason: msg };
  } finally {
    currentJob = null;
  }
}

/** Lance manuellement un job (via API admin). */
export async function triggerJob(kind: JobKind): Promise<{ ran: boolean; reason?: string }> {
  return runJobExclusive(kind);
}

/** Enregistre les 4 cron jobs. À appeler une seule fois au démarrage. */
export function startScheduler(): void {
  const jobs: Array<{ kind: JobKind; cron: string }> = [
    { kind: "discover", cron: process.env.CRON_DISCOVER ?? "0 3 * * *" },
    { kind: "metadata", cron: process.env.CRON_METADATA ?? "30 3 * * *" },
    { kind: "stream", cron: process.env.CRON_STREAM_TOP ?? "0 * * * *" },
    { kind: "full-stream", cron: process.env.CRON_FULL_STREAM ?? "0 4 * * 6" },
  ];

  for (const j of jobs) {
    if (!cron.validate(j.cron)) {
      console.warn(`[scheduler] cron invalide pour ${j.kind}: "${j.cron}" — ignoré`);
      continue;
    }
    cron.schedule(j.cron, () => {
      void runJobExclusive(j.kind);
    });
    console.log(`[scheduler] cron ${j.kind} → "${j.cron}"`);
  }
}

/** Stoppe tous les cron jobs (utile pour tests). */
export function stopScheduler(): void {
  cron.getTasks().forEach((t) => t.stop());
}
