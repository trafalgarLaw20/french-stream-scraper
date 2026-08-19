import {
  pgTable,
  serial,
  text,
  integer,
  real,
  timestamp,
  boolean,
  index,
  unique,
} from "drizzle-orm/pg-core";

export const series = pgTable(
  "series",
  {
    id: serial("id").primaryKey(),
    siteUrl: text("site_url").notNull().unique(),
    titre: text("titre").notNull(),
    titreOriginal: text("titre_original"),
    description: text("description"),
    annee: integer("annee"),
    note: real("note"),
    poster: text("poster"),
    backdrop: text("backdrop"),
    status: text("status"),
    metaHash: text("meta_hash"),
    popularity: integer("popularity").notNull().default(0),
    firstScrapedAt: timestamp("first_scraped_at", { withTimezone: true }).notNull().defaultNow(),
    lastMetaAt: timestamp("last_meta_at", { withTimezone: true }),
    lastStreamAt: timestamp("last_stream_at", { withTimezone: true }),
    deleted: boolean("deleted").notNull().default(false),
  },
  (t) => [
    index("idx_series_titre").on(t.titre),
    index("idx_series_annee").on(t.annee),
    index("idx_series_popularity").on(t.popularity),
  ],
);

export const seasons = pgTable(
  "seasons",
  {
    id: serial("id").primaryKey(),
    seriesId: integer("series_id").notNull(),
    number: integer("number").notNull(),
    titre: text("titre"),
    episodeCount: integer("episode_count"),
    firstScrapedAt: timestamp("first_scraped_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("seasons_series_id_number_unique").on(t.seriesId, t.number),
    index("idx_seasons_series").on(t.seriesId),
  ],
);

export const episodes = pgTable(
  "episodes",
  {
    id: serial("id").primaryKey(),
    seriesId: integer("series_id").notNull(),
    seasonId: integer("season_id"),
    number: integer("number").notNull(),
    titre: text("titre"),
    siteUrl: text("site_url").notNull().unique(),
    description: text("description"),
    duree: text("duree"),
    airDate: text("air_date"),
    lastStreamAt: timestamp("last_stream_at", { withTimezone: true }),
    firstScrapedAt: timestamp("first_scraped_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_episodes_series").on(t.seriesId),
    index("idx_episodes_season").on(t.seasonId),
  ],
);

