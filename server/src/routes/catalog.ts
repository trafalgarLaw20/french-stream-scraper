import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../../../pg/client.js";
import {
  movies,
  series,
  episodes,
  genres,
  countries,
  movieGenres,
  movieActors,
  actors,
  streamSources,
  streamDirect,
  seriesGenres,
} from "../../../pg/schema/index.js";
import {
  incrementMoviePopularity,
  incrementSeriesPopularity,
} from "../../../pg/repos/index.js";
import { getRefreshState, startMovieRefresh } from "../streamRefresh.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function likePattern(s: string): string {
  return `%${s}%`;
}

function clampLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

interface MovieListItem {
  id: number;
  titre: string | null;
  annee: number | null;
  poster: string | null;
  backdrop: string | null;
  note: number | null;
  duree: string | null;
  popularity: number;
}

function movieListFields() {
  return {
    id: movies.id,
    titre: movies.titre,
    annee: movies.annee,
    poster: movies.poster,
    backdrop: movies.backdrop,
    note: movies.note,
    duree: movies.duree,
    popularity: movies.popularity,
  };
}

function seriesListFields() {
  return {
    id: series.id,
    titre: series.titre,
    annee: series.annee,
    poster: series.poster,
    backdrop: series.backdrop,
    note: series.note,
    status: series.status,
    popularity: series.popularity,
  };
}

function makeCursor(rows: Array<{ id: number }>, limit: number): string | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1];
  return last ? String(last.id) : null;
}

function setETag(reply: { header: (k: string, v: string) => void }, payload: string): void {
  // ETag simple basé sur la longueur + hash léger (pas crypto pour rester rapide)
  const tag = `"${payload.length.toString(36)}-${Date.now().toString(36).slice(-4)}"`;
  reply.header("ETag", tag);
}

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  // ─── Home : top 20 + 6 genres + 10 nouveautés en 1 seul call ─────────
  app.get("/api/m/home", async (_req, reply) => {
    const top = await db
      .select(movieListFields())
      .from(movies)
      .where(eq(movies.deleted, false))
      .orderBy(desc(movies.popularity))
      .limit(20);

    const recent = await db
      .select(movieListFields())
      .from(movies)
      .where(eq(movies.deleted, false))
      .orderBy(desc(movies.firstScrapedAt))
      .limit(10);

    const topGenresRows = await db
      .select({ id: genres.id, name: genres.name, count: sql<number>`count(*)::int` })
      .from(genres)
      .innerJoin(movieGenres, eq(movieGenres.genreId, genres.id))
      .groupBy(genres.id, genres.name)
      .orderBy(desc(sql`count(*)`))
      .limit(6);

    const body = {
      top,
      recent,
      genres: topGenresRows,
      generatedAt: new Date().toISOString(),
    };
    const payload = JSON.stringify(body);
    setETag(reply, payload);
    reply.header("Cache-Control", "public, max-age=300");
    return reply.type("application/json").send(payload);
  });

  // ─── Liste paginée de films ──────────────────────────────────────────
  app.get("/api/m/movies", async (req, reply) => {
    const q = (req.query as Record<string, string | undefined>);
    const limit = clampLimit(q.limit);
    const cursorNum = q.cursor ? Number(q.cursor) : NaN;
    const genreFilter = q.genre;
    const yearFilter = q.year ? Number(q.year) : undefined;
    const search = q.q;

    const conditions = [eq(movies.deleted, false)];
    if (Number.isFinite(cursorNum)) conditions.push(lt(movies.id, cursorNum));
    if (yearFilter) conditions.push(eq(movies.annee, yearFilter));
    if (search) {
      conditions.push(sql`${movies.titre} ILIKE ${likePattern(search)}`);
    }

    let query;
    if (genreFilter) {
      query = db
        .select(movieListFields())
        .from(movies)
        .innerJoin(movieGenres, eq(movieGenres.movieId, movies.id))
        .innerJoin(genres, eq(genres.id, movieGenres.genreId))
        .where(and(eq(genres.name, genreFilter), ...conditions));
    } else {
      query = db.select(movieListFields()).from(movies).where(and(...conditions));
    }
    const rows = await query.orderBy(desc(movies.id)).limit(limit);

    return reply.send({
      items: rows,
      nextCursor: makeCursor(rows, limit),
    });
  });

  // ─── Détail d'un film (incrémente popularity) ────────────────────────
  app.get("/api/m/movies/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "id invalide" });

    const rows = await db
      .select({
        id: movies.id,
        siteUrl: movies.siteUrl,
        titre: movies.titre,
        titreOriginal: movies.titreOriginal,
        description: movies.description,
        annee: movies.annee,
        dateSortie: movies.dateSortie,
        duree: movies.duree,
        note: movies.note,
        poster: movies.poster,
        backdrop: movies.backdrop,
        langue: movies.langue,
        qualite: movies.qualite,
        version: movies.version,
        categories: movies.categories,
        popularity: movies.popularity,
        firstScrapedAt: movies.firstScrapedAt,
        lastMetaAt: movies.lastMetaAt,
        lastStreamAt: movies.lastStreamAt,
      })
      .from(movies)
      .where(eq(movies.id, id))
      .limit(1);

    if (rows.length === 0) return reply.code(404).send({ error: "film introuvable" });
    const movie = rows[0];

    const movieGenresRows = await db
      .select({ id: genres.id, name: genres.name })
      .from(genres)
      .innerJoin(movieGenres, eq(movieGenres.genreId, genres.id))
      .where(eq(movieGenres.movieId, id));

    const movieActorsRows = await db
      .select({ id: actors.id, name: actors.name })
      .from(actors)
      .innerJoin(movieActors, eq(movieActors.actorId, actors.id))
      .where(eq(movieActors.movieId, id))
      .limit(30);

    // Fire-and-forget : ne surtout pas laisser de promesse rejetée non gérée
    // (unhandledRejection fatale sous Node 24 → crash du serveur sur un simple
    // souci PG pendant une consultation de détail).
    incrementMoviePopularity(id).catch(() => undefined);
    return reply.send({ ...movie, genres: movieGenresRows, acteurs: movieActorsRows });
  });

  // ─── Streams d'un film (iframes + direct valides) ────────────────────
  app.get("/api/m/movies/:id/streams", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "id invalide" });

    type SourceRow = {
      id: number;
      host: string | null;
      iframeUrl: string;
      label: string | null;
      lastSeen: Date;
    };
    const sources: SourceRow[] = await db
      .select({
        id: streamSources.id,
        host: streamSources.host,
        iframeUrl: streamSources.iframeUrl,
        label: streamSources.label,
        lastSeen: streamSources.lastSeen,
      })
      .from(streamSources)
      .where(
        and(
          eq(streamSources.entityKind, "movie"),
          eq(streamSources.entityId, id),
        ),
      )
      .orderBy(desc(streamSources.lastSeen));

    const sourceIds = sources.map((s: SourceRow) => s.id);
    let directs: Array<{
      sourceId: number;
      url: string;
      protocol: "hls" | "mp4" | null;
      expiresAt: Date | null;
    }> = [];
    if (sourceIds.length > 0) {
      directs = await db
        .select({
          sourceId: streamDirect.sourceId,
          url: streamDirect.url,
          protocol: streamDirect.protocol,
          expiresAt: streamDirect.expiresAt,
        })
        .from(streamDirect)
        .where(
          and(
            inArray(streamDirect.sourceId, sourceIds),
            eq(streamDirect.valid, true),
            or(isNull(streamDirect.expiresAt), gt(streamDirect.expiresAt, new Date())),
          ),
        );
    }

    const directsBySource = new Map<number, typeof directs>();
    for (const d of directs) {
      const arr = directsBySource.get(d.sourceId) ?? [];
      arr.push(d);
      directsBySource.set(d.sourceId, arr);
    }

    return reply.send({
      streams: sources.map((s: SourceRow) => ({
        ...s,
        direct: directsBySource.get(s.id) ?? [],
      })),
    });
  });

  // ─── Refresh à la demande des flux d'un film ─────────────────────────
  app.post("/api/m/movies/:id/refresh", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "id invalide" });

    const exists = await db
      .select({ id: movies.id })
      .from(movies)
      .where(eq(movies.id, id))
      .limit(1);
    if (exists.length === 0) return reply.code(404).send({ error: "film introuvable" });

    const r = await startMovieRefresh(id);
    return reply.code(r.started ? 202 : 200).send(r);
  });

  app.get("/api/m/movies/:id/refresh", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "id invalide" });
    return reply.send(getRefreshState(id));
  });

  // ─── Liste paginée de séries ─────────────────────────────────────────
  app.get("/api/m/series", async (req, reply) => {
    const q = (req.query as Record<string, string | undefined>);
    const limit = clampLimit(q.limit);
    const cursorNum = q.cursor ? Number(q.cursor) : NaN;
    const search = q.q;

    const conditions = [eq(series.deleted, false)];
    if (Number.isFinite(cursorNum)) conditions.push(lt(series.id, cursorNum));
    if (search) {
      conditions.push(sql`${series.titre} ILIKE ${likePattern(search)}`);
    }

    const rows = await db
      .select(seriesListFields())
      .from(series)
      .where(and(...conditions))
      .orderBy(desc(series.id))
      .limit(limit);

    return reply.send({
      items: rows,
      nextCursor: makeCursor(rows, limit),
    });
  });

  // ─── Détail d'une série ──────────────────────────────────────────────
  app.get("/api/m/series/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "id invalide" });

    const rows = await db
      .select({
        id: series.id,
        siteUrl: series.siteUrl,
        titre: series.titre,
        titreOriginal: series.titreOriginal,
        description: series.description,
        annee: series.annee,
        note: series.note,
        poster: series.poster,
        backdrop: series.backdrop,
        status: series.status,
        popularity: series.popularity,
        firstScrapedAt: series.firstScrapedAt,
        lastMetaAt: series.lastMetaAt,
      })
      .from(series)
      .where(eq(series.id, id))
      .limit(1);

    if (rows.length === 0) return reply.code(404).send({ error: "série introuvable" });
    const s = rows[0];

    const seriesGenresRows = await db
      .select({ id: genres.id, name: genres.name })
      .from(genres)
      .innerJoin(seriesGenres, eq(seriesGenres.genreId, genres.id))
      .where(eq(seriesGenres.seriesId, id));

    const episodeCount = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(episodes)
      .where(eq(episodes.seriesId, id));

    incrementSeriesPopularity(id).catch(() => undefined);
    return reply.send({
      ...s,
      genres: seriesGenresRows,
      episodeCount: episodeCount[0]?.n ?? 0,
    });
  });

  // ─── Épisodes d'une série ────────────────────────────────────────────
  app.get("/api/m/series/:id/episodes", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "id invalide" });

    const rows = await db
      .select({
        id: episodes.id,
        number: episodes.number,
        titre: episodes.titre,
        description: episodes.description,
        duree: episodes.duree,
        airDate: episodes.airDate,
      })
      .from(episodes)
      .where(eq(episodes.seriesId, id))
      .orderBy(episodes.number);

    return reply.send({ items: rows });
  });

  // ─── Recherche unifiée films/séries ──────────────────────────────────
  app.get("/api/m/search", async (req, reply) => {
    const q = (req.query as Record<string, string | undefined>);
    const search = q.q ?? "";
    const kind = q.kind ?? "all";
    const limit = clampLimit(q.limit);

    if (!search.trim()) return reply.send({ items: [] });

    const out: Array<{ kind: "movie" | "series" } & Record<string, unknown>> = [];

    if (kind === "all" || kind === "movie") {
      const moviesRows = await db
        .select({ id: movies.id, titre: movies.titre, annee: movies.annee, poster: movies.poster })
        .from(movies)
        .where(and(eq(movies.deleted, false), sql`${movies.titre} ILIKE ${likePattern(search)}`))
        .orderBy(desc(movies.popularity))
        .limit(limit);
      for (const m of moviesRows) out.push({ kind: "movie", ...m });
    }
    if (kind === "all" || kind === "series") {
      const seriesRows = await db
        .select({ id: series.id, titre: series.titre, annee: series.annee, poster: series.poster })
        .from(series)
        .where(and(eq(series.deleted, false), sql`${series.titre} ILIKE ${likePattern(search)}`))
        .orderBy(desc(series.popularity))
        .limit(limit);
      for (const s of seriesRows) out.push({ kind: "series", ...s });
    }

    return reply.send({ items: out });
  });

  // ─── Facets : genres & années ────────────────────────────────────────
  app.get("/api/m/genres", async (_req, reply) => {
    const rows = await db
      .select({ id: genres.id, name: genres.name, count: sql<number>`count(*)::int` })
      .from(genres)
      .innerJoin(movieGenres, eq(movieGenres.genreId, genres.id))
      .innerJoin(movies, eq(movieGenres.movieId, movies.id))
      .where(eq(movies.deleted, false))
      .groupBy(genres.id, genres.name)
      .orderBy(desc(sql`count(*)`))
      .limit(100);
    return reply.send({ items: rows });
  });

  app.get("/api/m/years", async (_req, reply) => {
    const rows = await db
      .select({ annee: movies.annee, count: sql<number>`count(*)::int` })
      .from(movies)
      .where(and(eq(movies.deleted, false), sql`${movies.annee} IS NOT NULL`))
      .groupBy(movies.annee)
      .orderBy(desc(movies.annee))
      .limit(50);
    return reply.send({ items: rows });
  });

  app.get("/api/m/countries", async (_req, reply) => {
    const rows = await db.select({ id: countries.id, name: countries.name }).from(countries).orderBy(countries.name);
    return reply.send({ items: rows });
  });

  // Marker d'health-check
  app.get("/api/m/health", async () => ({ ok: true, ts: Date.now() }));
}
