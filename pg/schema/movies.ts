import {
  pgTable,
  serial,
  text,
  integer,
  real,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";

// Note FTS (full-text search) : pas de colonne tsvector pour le moment.
// Sprint 6 ajoutera une colonne tsvector + GIN index via raw migration SQL
// quand on codera l'endpoint /api/m/search. Pour la recherche MVP on
// utilisera ILIKE sur (titre, description).
export const movies = pgTable(
  "movies",
  {
    id: serial("id").primaryKey(),
    siteUrl: text("site_url").notNull().unique(),
    titre: text("titre").notNull(),
    titreOriginal: text("titre_original"),
    description: text("description"),
    annee: integer("annee"),
    dateSortie: text("date_sortie"),
    duree: text("duree"),
    note: real("note"),
    poster: text("poster"),
    backdrop: text("backdrop"),
    langue: text("langue").array(),
    qualite: text("qualite").array(),
    version: text("version").array(),
    categories: text("categories").array(),
    metaHash: text("meta_hash"),
    popularity: integer("popularity").notNull().default(0),
    firstScrapedAt: timestamp("first_scraped_at", { withTimezone: true }).notNull().defaultNow(),
    lastMetaAt: timestamp("last_meta_at", { withTimezone: true }),
    lastStreamAt: timestamp("last_stream_at", { withTimezone: true }),
    deleted: boolean("deleted").notNull().default(false),
  },
  (t) => [
    index("idx_movies_titre").on(t.titre),
    index("idx_movies_annee").on(t.annee),
    index("idx_movies_popularity").on(t.popularity),
    index("idx_movies_last_stream").on(t.lastStreamAt),
  ],
);
