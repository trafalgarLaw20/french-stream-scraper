import { and, eq, lt, sql } from "drizzle-orm";
import { db, type DBOrTx } from "../client";
import {
  movies,
  actors,
  directors,
  genres,
  countries,
  movieActors,
  movieDirectors,
  movieGenres,
  movieCountries,
  streamSources,
  streamDirect,
} from "../schema/index";
import type { MovieInfo } from "../../src/schema";
import { movieMetaHash, upsertRef } from "./shared";

function protocolFromUrl(url: string): "hls" | "mp4" {
  return url.includes(".m3u8") ? "hls" : "mp4";
}

/**
 * Upsert un MovieInfo (et ses N-N + stream_sources + stream_direct) en une transaction.
 * Si meta_hash est identique à l'existant, on skip l'écriture des métadonnées.
 */
export async function upsertMovie(info: MovieInfo): Promise<{ movieId: number; skipped: boolean }> {
  return await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: movies.id, metaHash: movies.metaHash })
      .from(movies)
      .where(eq(movies.siteUrl, info.url));

    const newHash = movieMetaHash(info);
    const movieId = existing[0]?.id;
    const skipMeta = existing[0]?.metaHash === newHash;

    if (!movieId) {
      const [m] = await tx
        .insert(movies)
        .values({
          siteUrl: info.url,
          titre: info.titre ?? "Sans titre",
          titreOriginal: info.titreOriginal ?? null,
          description: info.description,
          annee: info.annee,
          dateSortie: info.dateSortie,
          duree: info.duree,
          note: info.note,
          poster: info.poster,
          backdrop: info.backdrop,
          langue: info.langue,
          qualite: info.qualite,
          version: info.version,
          categories: info.categories,
          metaHash: newHash,
          lastMetaAt: new Date(),
          lastStreamAt: info.iframes.some((i) => i.streamDirect) ? new Date() : null,
        })
        .returning({ id: movies.id });
      await writeRelations(tx, m.id, info);
      await writeStreams(tx, "movie" as const, m.id, info);
      return { movieId: m.id, skipped: false };
    }

    if (!skipMeta) {
      await tx
        .update(movies)
        .set({
          titre: info.titre ?? "Sans titre",
          titreOriginal: info.titreOriginal ?? null,
          description: info.description,
          annee: info.annee,
          dateSortie: info.dateSortie,
          duree: info.duree,
          note: info.note,
          poster: info.poster,
          backdrop: info.backdrop,
          langue: info.langue,
          qualite: info.qualite,
          version: info.version,
          categories: info.categories,
          metaHash: newHash,
          lastMetaAt: new Date(),
          ...(info.iframes.some((i) => i.streamDirect)
            ? { lastStreamAt: new Date() }
            : {}),
        })
        .where(eq(movies.id, movieId));
      await wipeRelations(tx, movieId);
      await writeRelations(tx, movieId, info);
    }

    // Toujours rafraîchir les streams si on en a (le streamDirect change toutes les 48h)
    if (info.iframes.some((i) => i.streamDirect)) {
      await writeStreams(tx, "movie" as const, movieId, info);
    }

    return { movieId, skipped: skipMeta };
  });
}

async function wipeRelations(tx: DBOrTx, movieId: number): Promise<void> {
  await tx.delete(movieActors).where(eq(movieActors.movieId, movieId));
  await tx.delete(movieDirectors).where(eq(movieDirectors.movieId, movieId));
  await tx.delete(movieGenres).where(eq(movieGenres.movieId, movieId));
  await tx.delete(movieCountries).where(eq(movieCountries.movieId, movieId));
}

async function writeRelations(tx: DBOrTx, movieId: number, info: MovieInfo): Promise<void> {
  for (const g of info.genres ?? []) {
    if (!g) continue;
    const id = await upsertRef(tx, genres, g);
    await tx.insert(movieGenres).values({ movieId, genreId: id }).onConflictDoNothing();
  }
  for (const a of info.acteurs ?? []) {
    if (!a) continue;
    const id = await upsertRef(tx, actors, a);
    await tx.insert(movieActors).values({ movieId, actorId: id }).onConflictDoNothing();
  }
  for (const d of info.realisation ?? []) {
    if (!d) continue;
    const id = await upsertRef(tx, directors, d);
    await tx.insert(movieDirectors).values({ movieId, directorId: id }).onConflictDoNothing();
  }
  for (const c of info.pays ?? []) {
    if (!c) continue;
    const id = await upsertRef(tx, countries, c);
    await tx.insert(movieCountries).values({ movieId, countryId: id }).onConflictDoNothing();
  }
}

export async function writeStreams(
  tx: DBOrTx,
  entityKind: "movie" | "episode",
  entityId: number,
  info: { iframes: MovieInfo["iframes"] },
): Promise<void> {
  for (const iframe of info.iframes ?? []) {
    if (!iframe?.url) continue;
    const [src] = await tx
      .insert(streamSources)
      .values({
        entityKind,
        entityId,
        host: iframe.host,
        iframeUrl: iframe.url,
        label: iframe.label,
      })
      .onConflictDoUpdate({
        target: [streamSources.entityKind, streamSources.entityId, streamSources.iframeUrl],
        set: { lastSeen: new Date(), host: iframe.host, label: iframe.label },
      })
      .returning({ id: streamSources.id });

    if (iframe.streamDirect) {
      await tx
        .insert(streamDirect)
        .values({
          sourceId: src.id,
          url: iframe.streamDirect,
          protocol: protocolFromUrl(iframe.streamDirect),
          expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
          valid: true,
        })
        .onConflictDoNothing();
    }
  }
}

/** Invalide les stream_direct expirés (valid=true mais expires_at < now). */
export async function invalidateExpiredStreams(): Promise<number> {
  const res = await db
    .update(streamDirect)
    .set({ valid: false })
    .where(and(eq(streamDirect.valid, true), lt(streamDirect.expiresAt, new Date())))
    .returning({ id: streamDirect.id });
  return res.length;
}

/** Incrémente le compteur de popularité (déclenché par les GET /api/m/movies/:id). */
export async function incrementMoviePopularity(id: number): Promise<void> {
  await db
    .update(movies)
    .set({ popularity: sql`${movies.popularity} + 1` })
    .where(eq(movies.id, id));
}

export async function incrementSeriesPopularity(id: number): Promise<void> {
  // importé dynamiquement pour éviter une circularité de deps
  const { series } = await import("../schema/index");
  await db
    .update(series)
    .set({ popularity: sql`${series.popularity} + 1` })
    .where(eq(series.id, id));
}
