import {
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  integer,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { entityKindEnum, streamProtocolEnum } from "./enums";

// Sources polymorphes : entity_kind + entity_id référence movies.id ou episodes.id
export const streamSources = pgTable(
  "stream_sources",
  {
    id: serial("id").primaryKey(),
    entityKind: entityKindEnum("entity_kind").notNull(),
    entityId: integer("entity_id").notNull(),
    host: text("host"),
    iframeUrl: text("iframe_url").notNull(),
    label: text("label"),
    version: text("version"),
    quality: text("quality"),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("stream_sources_entity_iframe_unique").on(t.entityKind, t.entityId, t.iframeUrl),
    index("idx_stream_sources_entity").on(t.entityKind, t.entityId),
    index("idx_stream_sources_host").on(t.host),
  ],
);

export const streamDirect = pgTable(
  "stream_direct",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id").notNull(),
    url: text("url").notNull(),
    protocol: streamProtocolEnum("protocol"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    valid: boolean("valid").notNull().default(true),
  },
  (t) => [
    unique("stream_direct_source_url_unique").on(t.sourceId, t.url),
    index("idx_stream_direct_source").on(t.sourceId),
    index("idx_stream_direct_valid").on(t.sourceId).where(sql`${t.valid} = true`),
  ],
);

