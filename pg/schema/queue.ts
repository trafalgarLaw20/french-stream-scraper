import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { urlKindEnum, queueStatusEnum, runKindEnum } from "./enums";

export const urlQueue = pgTable(
  "url_queue",
  {
    id: serial("id").primaryKey(),
    url: text("url").notNull().unique(),
    kind: urlKindEnum("kind"),
    parentSeriesId: integer("parent_series_id"),
    status: queueStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_queue_status").on(t.status),
    index("idx_queue_kind").on(t.kind),
    index("idx_queue_parent_series").on(t.parentSeriesId),
  ],
);

export const scrapeRuns = pgTable("scrape_runs", {
  id: serial("id").primaryKey(),
  kind: runKindEnum("kind"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  total: integer("total"),
  ok: integer("ok"),
  errors: integer("errors"),
  durationMs: integer("duration_ms"),
});
