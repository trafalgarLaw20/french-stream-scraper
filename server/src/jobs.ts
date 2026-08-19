import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import { scrapeMovie } from "../../src/index.js";
import type { MovieInfo, ScrapeEvent } from "../../src/schema.js";
import { insertMovie } from "./db.js";

export type JobStatus = "pending" | "running" | "done" | "error";

export interface Job {
  id: string;
  url: string;
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  events: ScrapeEvent[];
  result: MovieInfo | null;
  error: string | null;
}

const jobs = new Map<string, Job>();
const emitter = new EventEmitter();
emitter.setMaxListeners(100);

// File d'attente globale : un seul job à la fois pour éviter le bannissement
// Cloudflare et la surcharge mémoire (un seul navigateur Playwright à la fois).
interface QueuedItem {
  job: Job;
  opts: { resolveStreams?: boolean; verbose?: boolean; timeoutMs?: number };
}
const queue: QueuedItem[] = [];
let processing = false;
let lastJobFinishedAt = 0;
const INTER_JOB_DELAY_MS = 4000;
const MAX_RETAINED_JOBS = 200;

export function onJobEvent(listener: (jobId: string, event: ScrapeEvent) => void): () => void {
  emitter.on("job:event", listener);
  return () => emitter.off("job:event", listener);
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

function cleanupOldJobs(): void {
  if (jobs.size <= MAX_RETAINED_JOBS) return;
  const terminated = [...jobs.values()]
    .filter((j) => j.status === "done" || j.status === "error")
    .sort((a, b) => (a.finishedAt ?? "").localeCompare(b.finishedAt ?? ""));
  const excess = jobs.size - MAX_RETAINED_JOBS;
  for (let i = 0; i < excess && i < terminated.length; i++) {
    jobs.delete(terminated[i].id);
  }
}

export function createJob(
  url: string,
  opts: { resolveStreams?: boolean; verbose?: boolean; timeoutMs?: number } = {},
): string {
  const id = nanoid(12);
  const job: Job = {
    id,
    url,
    status: "pending",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    events: [],
    result: null,
    error: null,
  };
  jobs.set(id, job);
  cleanupOldJobs();

  queue.push({ job, opts });
  void processQueue();

  return id;
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const { job, opts } = queue.shift()!;

      // Respecter le délai anti-ban depuis la fin du job précédent.
      if (lastJobFinishedAt > 0) {
        const elapsed = Date.now() - lastJobFinishedAt;
        const wait = Math.max(0, INTER_JOB_DELAY_MS - elapsed);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }

      job.status = "running";

      try {
        const movie = await scrapeMovie(job.url, {
          resolveStreams: opts.resolveStreams,
          verbose: opts.verbose,
          timeoutMs: opts.timeoutMs,
          onProgress: (event) => {
            job.events.push(event);
            emitter.emit("job:event", job.id, event);
          },
        });
        job.result = movie;
        job.status = "done";
        job.finishedAt = new Date().toISOString();
        insertMovie(job.id, movie);
        emitter.emit("job:event", job.id, { type: "done", movie } as ScrapeEvent);
      } catch (e) {
        job.error = (e as Error).message;
        job.status = "error";
        job.finishedAt = new Date().toISOString();
        emitter.emit("job:event", job.id, { type: "error", message: job.error } as ScrapeEvent);
      }

      lastJobFinishedAt = Date.now();
    }
  } finally {
    processing = false;
  }
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function recentDoneJobs(limit = 10): Job[] {
  return listJobs()
    .filter((j) => j.status === "done" && j.result)
    .slice(0, limit);
}
