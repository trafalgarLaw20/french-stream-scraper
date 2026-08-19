import { pgTable, serial, text, integer, real, timestamp, boolean, index, primaryKey } from "drizzle-orm/pg-core";

export const actors = pgTable(
  "actors",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
  },
  (t) => [index("idx_actors_name").on(t.name)],
);

export const directors = pgTable(
  "directors",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
  },
  (t) => [index("idx_directors_name").on(t.name)],
);

export const genres = pgTable(
  "genres",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
  },
  (t) => [index("idx_genres_name").on(t.name)],
);

export const countries = pgTable(
  "countries",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
  },
  (t) => [index("idx_countries_name").on(t.name)],
);

export const movieActors = pgTable(
  "movie_actors",
  {
    movieId: integer("movie_id").notNull(),
    actorId: integer("actor_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.movieId, t.actorId] })],
);

export const movieDirectors = pgTable(
  "movie_directors",
  {
    movieId: integer("movie_id").notNull(),
    directorId: integer("director_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.movieId, t.directorId] })],
);

export const movieGenres = pgTable(
  "movie_genres",
  {
    movieId: integer("movie_id").notNull(),
    genreId: integer("genre_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.movieId, t.genreId] }),
    index("idx_movie_genres_genre").on(t.genreId),
  ],
);

export const movieCountries = pgTable(
  "movie_countries",
  {
    movieId: integer("movie_id").notNull(),
    countryId: integer("country_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.movieId, t.countryId] })],
);

export const seriesGenres = pgTable(
  "series_genres",
  {
    seriesId: integer("series_id").notNull(),
    genreId: integer("genre_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.seriesId, t.genreId] }),
    index("idx_series_genres_genre").on(t.genreId),
  ],
);

export const seriesActors = pgTable(
  "series_actors",
  {
    seriesId: integer("series_id").notNull(),
    actorId: integer("actor_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.actorId] })],
);

export const seriesCreators = pgTable(
  "series_creators",
  {
    seriesId: integer("series_id").notNull(),
    directorId: integer("director_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.directorId] })],
);

