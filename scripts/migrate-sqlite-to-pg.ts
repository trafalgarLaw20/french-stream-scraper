/**
 * Migration one-shot : data/history.sqlite → PostgreSQL.
 *
 * Usage : npx tsx scripts/migrate-sqlite-to-pg.ts
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { db, pgPool, type DBOrTx } from "../pg/client";
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
} from "../pg/schema";

const SQLITE_PATH = resolve("data/history.sqlite");

interface StreamSrc {
  host: string | null;
  url: string;
  streamDirect: string | null;
  label: string | null;
}

interface MovieInfo {
  url: string;
  titre: string | null;
  titreOriginal?: string | null;
  description: string | null;
  annee: number | null;
  dateSortie: string | null;
  categories: string[];
  genres: string[];
  pays: string[];
  realisation: string[];
  acteurs: string[];
  duree: string | null;
  note: number | null;
  qualite: string[];
  version: string[];
  langue: string[];
  poster: string | null;
  backdrop: string | null;
  iframes: StreamSrc[];
  scrapedAt: string;
}

function metaHash(m: MovieInfo): string {
  const stable = {
    titre: m.titre,
    titreOriginal: m.titreOriginal,
    description: m.description,
    annee: m.annee,
    dateSortie: m.dateSortie,
    categories: m.categories,
    genres: m.genres,
    pays: m.pays,
    realisation: m.realisation,
    acteurs: m.acteurs,
    duree: m.duree,
    note: m.note,
    qualite: m.qualite,
    version: m.version,
    langue: m.langue,
  };
  return createHash("sha1").update(JSON.stringify(stable)).digest("hex");
}

async function upsertName(
  tx: DBOrTx,
  table: typeof actors | typeof directors | typeof genres | typeof countries,
  name: string,
): Promise<number> {
  const [row] = await tx
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(table as any)
    .values({ name })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .onConflictDoUpdate({ target: (table as any).name, set: { name } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .returning({ id: (table as any).id });
  return row.id as number;
}

function protocolFromUrl(url: string): "hls" | "mp4" {
  return url.includes(".m3u8") ? "hls" : "mp4";
}

async function migrateOne(info: MovieInfo): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: movies.id })
      .from(movies)
      .where(eq(movies.siteUrl, info.url));

    const data = {
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
      metaHash: metaHash(info),
      firstScrapedAt: new Date(info.scrapedAt),
      lastMetaAt: new Date(),
    };

    let movieId: number;
    if (existing.length > 0) {
      movieId = existing[0].id;
      await tx.update(movies).set(data).where(eq(movies.id, movieId));
      await tx.delete(movieActors).where(eq(movieActors.movieId, movieId));
      await tx.delete(movieDirectors).where(eq(movieDirectors.movieId, movieId));
      await tx.delete(movieGenres).where(eq(movieGenres.movieId, movieId));
      await tx.delete(movieCountries).where(eq(movieCountries.movieId, movieId));
      await tx
        .delete(streamSources)
        .where(
          and(eq(streamSources.entityKind, "movie"), eq(streamSources.entityId, movieId)),
        );
    } else {
      const [m] = await tx.insert(movies).values(data).returning({ id: movies.id });
      movieId = m.id;
    }

    for (const g of info.genres ?? []) {
      if (!g) continue;
      const id = await upsertName(tx, genres, g);
      await tx
        .insert(movieGenres)
        .values({ movieId, genreId: id })
        .onConflictDoNothing();
    }
    for (const a of info.acteurs ?? []) {
      if (!a) continue;
      const id = await upsertName(tx, actors, a);
      await tx
        .insert(movieActors)
        .values({ movieId, actorId: id })
        .onConflictDoNothing();
    }
    for (const d of info.realisation ?? []) {
      if (!d) continue;
      const id = await upsertName(tx, directors, d);
      await tx
        .insert(movieDirectors)
        .values({ movieId, directorId: id })
        .onConflictDoNothing();
    }
    for (const c of info.pays ?? []) {
      if (!c) continue;
      const id = await upsertName(tx, countries, c);
      await tx
        .insert(movieCountries)
        .values({ movieId, countryId: id })
        .onConflictDoNothing();
    }

    for (const iframe of info.iframes ?? []) {
      if (!iframe?.url) continue;
      const [src] = await tx
        .insert(streamSources)
        .values({
          entityKind: "movie",
          entityId: movieId,
          host: iframe.host,
          iframeUrl: iframe.url,
          label: iframe.label,
        })
        .onConflictDoUpdate({
          target: [
            streamSources.entityKind,
            streamSources.entityId,
            streamSources.iframeUrl,
          ],
          set: {
            lastSeen: new Date(),
            host: iframe.host,
            label: iframe.label,
          },
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
  });
}

async function main(): Promise<void> {
  console.log(`Lecture de ${SQLITE_PATH}…`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const rows = sqlite
    .prepare("SELECT json FROM history ORDER BY scrapedAt DESC")
    .all() as { json: string }[];
  sqlite.close();
  console.log(`${rows.length} lignes SQLite à migrer`);

  let ok = 0;
  let skipped = 0;
  let errored = 0;
  const seenUrls = new Set<string>();

  for (const row of rows) {
    let info: MovieInfo;
    try {
      info = JSON.parse(row.json) as MovieInfo;
    } catch (e) {
      errored++;
      console.error(`JSON invalide:`, (e as Error).message);
      continue;
    }
    if (!info?.url || !info.titre) {
      skipped++;
      continue;
    }
    if (seenUrls.has(info.url)) {
      skipped++;
      continue;
    }
    seenUrls.add(info.url);

    try {
      await migrateOne(info);
      ok++;
      console.log(`  ✓ ${info.titre}`);
    } catch (e) {
      errored++;
      console.error(`  ✗ ${info.url}:`, (e as Error).message);
    }
  }

  console.log(`\nMigration terminée : ${ok} ok, ${skipped} ignorés, ${errored} erreurs`);
  await pgPool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
