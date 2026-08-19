import type { FastifyInstance } from "fastify";
import { createJob, getJob, onJobEvent, listJobs } from "./jobs.js";
import { listHistory, getHistoryById, deleteHistoryById, rowToMovie } from "./db.js";
import { triggerJob, getCurrentJob } from "../../scheduler/index.js";
import { queueStats, resetStale } from "../../pg/repos/index.js";
import { db } from "../../pg/client.js";
import { scrapeRuns } from "../../pg/schema/index.js";
import { desc, eq } from "drizzle-orm";
import type { JobKind } from "../../scheduler/jobs.js";
import { registerCatalogRoutes } from "./routes/catalog.js";

function serializeJob(job: ReturnType<typeof getJob>) {
  if (!job) return null;
  return {
    id: job.id,
    url: job.url,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    result: job.result,
    events: job.events,
  };
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await registerCatalogRoutes(app);

  app.post("/api/scrape", async (req, reply) => {
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== "string") {
      return reply.code(400).send({ error: "url requis" });
    }
    const body = (req.body as { resolveStreams?: boolean; timeoutMs?: number }) ?? {};
    const id = createJob(url, {
      resolveStreams: body.resolveStreams !== false,
      timeoutMs: body.timeoutMs,
    });
    return reply.code(202).send({ jobId: id });
  });

  app.post("/api/batch", async (req, reply) => {
    const { urls, resolveStreams, timeoutMs } = req.body as {
      urls?: string[];
      resolveStreams?: boolean;
      delayMs?: number;
      timeoutMs?: number;
    };
    if (!Array.isArray(urls) || urls.length === 0) {
      return reply.code(400).send({ error: "urls[] requis" });
    }
    // Les jobs sont mis en file et exécutés séquentiellement par jobs.ts
    // (un seul à la fois + délai anti-ban de 4s entre chaque). On crée juste
    // les entrées ici, sans attendre côté HTTP — sinon la requête bloque
    // pendant des minutes.
    const ids: string[] = [];
    for (const u of urls) {
      if (typeof u !== "string" || !u) continue;
      const id = createJob(u, {
        resolveStreams: resolveStreams !== false,
        timeoutMs,
      });
      ids.push(id);
    }
    return reply.code(202).send({ jobIds: ids });
  });

  app.get("/api/events/:jobId", async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = getJob(jobId);
    if (!job) return reply.code(404).send({ error: "job introuvable" });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    for (const e of job.events) send(e.type, e);
    if (job.status === "done" || job.status === "error") {
      send("__final__", { status: job.status });
      reply.raw.end();
      return;
    }

    send("__hello__", { jobId });

    const unsubscribe = onJobEvent((emitJobId, event) => {
      if (emitJobId !== jobId) return;
      send(event.type, event);
      if (event.type === "done" || event.type === "error") {
        send("__final__", { status: event.type === "done" ? "done" : "error" });
        reply.raw.end();
        unsubscribe();
      }
    });

    req.raw.on("close", () => {
      unsubscribe();
    });
  });

  app.get("/api/jobs", async () => {
    return { jobs: listJobs().map(serializeJob) };
  });

  app.get("/api/jobs/:jobId", async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = serializeJob(getJob(jobId));
    if (!job) return reply.code(404).send({ error: "job introuvable" });
    return job;
  });

  app.get("/api/history", async (req) => {
    const q = (req.query as { q?: string }).q;
    const rows = listHistory(q);
    return {
      items: rows.map((r) => ({
        id: r.id,
        url: r.url,
        titre: r.titre,
        annee: r.annee,
        poster: r.poster,
        backdrop: r.backdrop,
        scrapedAt: r.scrapedAt,
      })),
    };
  });

  app.get("/api/history/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getHistoryById(id);
    if (!row) return reply.code(404).send({ error: "introuvable" });
    return rowToMovie(row);
  });

  app.delete("/api/history/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = deleteHistoryById(id);
    if (!ok) return reply.code(404).send({ error: "introuvable" });
    return { ok: true };
  });

  app.get("/api/export/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const format = ((req.query as { format?: string }).format ?? "json").toLowerCase();
    const row = getHistoryById(id);
    if (!row) return reply.code(404).send({ error: "introuvable" });
    const movie = rowToMovie(row);

    if (format === "csv") {
      const headers = [
        "titre",
        "annee",
        "dateSortie",
        "genres",
        "realisation",
        "duree",
        "url",
        "iframes_url",
        "iframes_stream",
      ];
      const esc = (v: unknown) =>
        `"${String(v ?? "").replace(/"/g, '""')}"`;
      const line = [
        movie.titre,
        movie.annee,
        movie.dateSortie,
        movie.genres.join(" | "),
        movie.realisation.join(" | "),
        movie.duree,
        movie.url,
        movie.iframes.map((i) => i.url).join(" | "),
        movie.iframes.map((i) => i.streamDirect ?? "").join(" | "),
      ]
        .map(esc)
        .join(",");
      reply.type("text/csv; charset=utf-8");
      reply.header(
        "Content-Disposition",
        `attachment; filename="${(movie.titre ?? "movie").replace(/[^\w-]+/g, "_")}.csv"`,
      );
      return headers.join(",") + "\n" + line + "\n";
    }

    reply.type("application/json; charset=utf-8");
    reply.header(
      "Content-Disposition",
      `attachment; filename="${(movie.titre ?? "movie").replace(/[^\w-]+/g, "_")}.json"`,
    );
    return JSON.stringify(movie, null, 2);
  });

  // ─── Admin API (scheduler / queue / runs) ──────────────────────────────

  function isAdminReq(req: { headers: Record<string, string | string[] | undefined> }): boolean {
    const token = process.env.ADMIN_API_TOKEN;
    if (!token) return true; // Pas de token configuré = pas d'auth (mode dev local)
    const provided = req.headers["x-admin-token"];
    return provided === token;
  }

  app.get("/api/admin/status", async (req, reply) => {
    if (!isAdminReq(req)) return reply.code(401).send({ error: "token admin requis" });
    const stats = await queueStats();
    const stale = await resetStale().catch(() => 0);
    return {
      currentJob: getCurrentJob(),
      queue: stats,
      staleReset: stale,
    };
  });

  app.post("/api/admin/crawl", async (req, reply) => {
    if (!isAdminReq(req)) return reply.code(401).send({ error: "token admin requis" });
    const { kind } = (req.body ?? {}) as { kind?: JobKind };
    const validKinds: JobKind[] = ["discover", "metadata", "stream", "full-stream"];
    if (!kind || !validKinds.includes(kind)) {
      return reply.code(400).send({
        error: `kind doit être parmi ${validKinds.join(", ")}`,
      });
    }
    // Check si déjà en cours → 409 sans bloquer
    if (getCurrentJob()) {
      return reply.code(409).send({
        ran: false,
        reason: `${getCurrentJob()} déjà en cours`,
      });
    }
    // Démarre en arrière-plan — ne pas await (sinon la requête HTTP attend la fin du job,
    // qui peut durer des heures pour un metadata/full-stream).
    void triggerJob(kind);
    return reply
      .code(202)
      .send({ ran: true, message: `job "${kind}" démarré en arrière-plan` });
  });

  app.get("/api/admin/runs", async (req, reply) => {
    if (!isAdminReq(req)) return reply.code(401).send({ error: "token admin requis" });
    const limit = Math.min(
      Math.max(Number((req.query as { limit?: string }).limit ?? "20"), 1),
      200,
    );
    const rows = await db
      .select()
      .from(scrapeRuns)
      .orderBy(desc(scrapeRuns.startedAt))
      .limit(limit);
    return { runs: rows };
  });

  app.get("/api/admin/runs/:id", async (req, reply) => {
    if (!isAdminReq(req)) return reply.code(401).send({ error: "token admin requis" });
    const { id } = req.params as { id: string };
    const rows = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, Number(id))).limit(1);
    if (rows.length === 0) return reply.code(404).send({ error: "run introuvable" });
    return rows[0];
  });
}
