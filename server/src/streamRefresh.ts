import { eq } from "drizzle-orm";
import { db } from "../../pg/client";
import { movies } from "../../pg/schema/index";
import { upsertMovie } from "../../pg/repos";
import { scrapeMovie } from "../../src/index.js";

/**
 * Refresh à la demande des flux d'un film du catalogue.
 *
 * Les liens directs (m3u8/mp4) expirent côté hébergeurs au bout de ~12-48h.
 * Ce module permet de relancer la collecte + résolution pour UN film précis
 * (bouton « Rafraîchir » du modal de détail, ou auto-refresh à l'ouverture
 * quand tous les flux sont expirés), sans passer par la url_queue du scheduler.
 *
 * Un cooldown par film évite de re-scrapper en bouche (anti-ban) : tant qu'un
 * refresh a démarré il y a moins de COOLDOWN_MS, les nouvelles demandes
 * renvoient started=false sans rien relancer.
 */

export interface RefreshState {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  ok: boolean | null;
  error: string | null;
  /** true si un refresh a démarré il y a moins de COOLDOWN_MS. */
  cooldown: boolean;
}

const COOLDOWN_MS = 5 * 60 * 1000;

const states = new Map<number, RefreshState>();

function emptyState(): RefreshState {
  return { running: false, startedAt: null, finishedAt: null, ok: null, error: null, cooldown: false };
}

export function getRefreshState(movieId: number): RefreshState {
  const s = states.get(movieId) ?? emptyState();
  return {
    ...s,
    cooldown: !!s.startedAt && Date.now() - s.startedAt < COOLDOWN_MS,
  };
}

/**
 * Démarre (ou rejoint) le refresh d'un film. Retourne { started: true } si un
 * scrape vient d'être lancé, ou { started: false, reason } si déjà en cours /
 * en cooldown / film introuvable.
 */
export async function startMovieRefresh(
  movieId: number,
): Promise<{ started: boolean; reason?: string }> {
  const current = states.get(movieId);
  if (current?.running) return { started: false, reason: "un refresh est déjà en cours" };
  if (current?.startedAt && Date.now() - current.startedAt < COOLDOWN_MS) {
    return { started: false, reason: "cooldown — un refresh a été lancé récemment" };
  }

  const rows = await db
    .select({ siteUrl: movies.siteUrl, titre: movies.titre })
    .from(movies)
    .where(eq(movies.id, movieId))
    .limit(1);
  if (!rows[0]?.siteUrl) return { started: false, reason: "film introuvable" };

  const state: RefreshState = {
    running: true,
    startedAt: Date.now(),
    finishedAt: null,
    ok: null,
    error: null,
    cooldown: true,
  };
  states.set(movieId, state);
  const { siteUrl, titre } = rows[0];
  console.log(`[refresh] film ${movieId} (${titre}) — démarrage`);

  // Fire-and-forget : l'état est consultable via GET /api/m/movies/:id/refresh
  void (async () => {
    try {
      const info = await scrapeMovie(siteUrl, { resolveStreams: true });
      await upsertMovie(info);
      state.running = false;
      state.finishedAt = Date.now();
      state.ok = true;
      const n = info.iframes.filter((i) => i.streamDirect).length;
      console.log(`[refresh] film ${movieId} (${titre}) — ok, ${n} flux direct(s)`);
    } catch (e) {
      state.running = false;
      state.finishedAt = Date.now();
      state.ok = false;
      state.error = (e as Error).message;
      console.error(`[refresh] film ${movieId} (${titre}) — échec: ${(e as Error).message}`);
    }
  })();

  return { started: true };
}
