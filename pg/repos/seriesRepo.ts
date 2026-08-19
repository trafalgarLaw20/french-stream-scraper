import { eq } from "drizzle-orm";
import { db, type DBOrTx } from "../client";
import {
  series,
  episodes,
  actors,
  directors,
  genres,
  seriesActors,
  seriesGenres,
  seriesCreators,
} from "../schema/index";
import type { SeriesInfo } from "../../src/schema";
import { seriesMetaHash, upsertRef } from "./shared";

/**
 * Upsert un SeriesInfo (métadonnées + N-N + épisodes).
 *
 * Note MVP : une page série = une saison spécifique ("FROM - Saison 4" par ex.).
 * On stocke chaque page comme une row `series` individuelle avec son seasonNumber.
 * Le grouping "série abstraite" (FROM = entité parente) sera fait dans un script
 * de consolidation ultérieur (pas au sprint 4).
 *
 * Les épisodes sont insérés/upsertés sur (series_id, number, version).
 * Les streams des épisodes ne sont PAS résolus ici (sprint 4 MVP).
 */
export async function upsertSeries(
  info: SeriesInfo,
): Promise<{ seriesId: number; skipped: boolean }> {
  return await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: series.id, metaHash: series.metaHash })
      .from(series)
      .where(eq(series.siteUrl, info.url));

    const newHash = seriesMetaHash(info);
    const existingId = existing[0]?.id;
    const skipMeta = existing[0]?.metaHash === newHash;

    let seriesId: number;

    if (!existingId) {
      const [s] = await tx
        .insert(series)
        .values({
          siteUrl: info.url,
          titre: info.titre ?? "Sans titre",
          titreOriginal: info.titreOriginal ?? null,
          description: info.description,
          annee: info.annee,
          note: info.note,
          poster: info.poster,
          backdrop: info.backdrop,
          status: info.status,
          metaHash: newHash,
          lastMetaAt: new Date(),
        })
        .returning({ id: series.id });
      seriesId = s.id;
      await writeSeriesRelations(tx, seriesId, info);
    } else {
      seriesId = existingId;
      if (!skipMeta) {
        await tx
          .update(series)
          .set({
            titre: info.titre ?? "Sans titre",
            titreOriginal: info.titreOriginal ?? null,
            description: info.description,
            annee: info.annee,
            note: info.note,
            poster: info.poster,
            backdrop: info.backdrop,
            status: info.status,
            metaHash: newHash,
            lastMetaAt: new Date(),
          })
          .where(eq(series.id, seriesId));
        await wipeSeriesRelations(tx, seriesId);
        await writeSeriesRelations(tx, seriesId, info);
      }
    }

    // Toujours rafraîchir les épisodes (leurs nombres/titres peuvent changer)
    await upsertEpisodes(tx, seriesId, info);

    return { seriesId, skipped: skipMeta };
  });
}

async function wipeSeriesRelations(tx: DBOrTx, seriesId: number): Promise<void> {
  await tx.delete(seriesActors).where(eq(seriesActors.seriesId, seriesId));
  await tx.delete(seriesGenres).where(eq(seriesGenres.seriesId, seriesId));
  await tx.delete(seriesCreators).where(eq(seriesCreators.seriesId, seriesId));
}

async function writeSeriesRelations(tx: DBOrTx, seriesId: number, info: SeriesInfo): Promise<void> {
  for (const g of info.genres ?? []) {
    if (!g) continue;
    const id = await upsertRef(tx, genres, g);
    await tx.insert(seriesGenres).values({ seriesId, genreId: id }).onConflictDoNothing();
  }
  for (const a of info.acteurs ?? []) {
    if (!a) continue;
    const id = await upsertRef(tx, actors, a);
    await tx.insert(seriesActors).values({ seriesId, actorId: id }).onConflictDoNothing();
  }
  for (const d of info.realisation ?? []) {
    if (!d) continue;
    const id = await upsertRef(tx, directors, d);
    await tx.insert(seriesCreators).values({ seriesId, directorId: id }).onConflictDoNothing();
  }
}

async function upsertEpisodes(
  tx: DBOrTx,
  seriesId: number,
  info: SeriesInfo,
): Promise<void> {
  // Pas d'URL directe par épisode sur french-stream.one (chargement via clic).
  // On utilise une URL synthétique basée sur (page-url + version + numéro) pour
  // respecter la contrainte UNIQUE(site_url) de la table episodes.
  for (const ep of info.episodes ?? []) {
    const epUrl = `${info.url}#ep=${ep.version}-${ep.number}`;
    await tx
      .insert(episodes)
      .values({
        seriesId,
        number: ep.number,
        titre: ep.title,
        siteUrl: epUrl,
      })
      .onConflictDoUpdate({
        target: episodes.siteUrl,
        set: { titre: ep.title, seriesId },
      });
  }
}
