CREATE TYPE "public"."entity_kind" AS ENUM('movie', 'episode');--> statement-breakpoint
CREATE TYPE "public"."queue_status" AS ENUM('pending', 'running', 'done', 'error', 'stale');--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('discover', 'metadata', 'stream', 'full-stream');--> statement-breakpoint
CREATE TYPE "public"."stream_protocol" AS ENUM('hls', 'mp4');--> statement-breakpoint
CREATE TYPE "public"."url_kind" AS ENUM('movie', 'series', 'episode');--> statement-breakpoint
CREATE TABLE "actors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "actors_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "countries_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "directors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "directors_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"series_id" integer NOT NULL,
	"season_id" integer,
	"number" integer NOT NULL,
	"titre" text,
	"site_url" text NOT NULL,
	"description" text,
	"duree" text,
	"air_date" text,
	"last_stream_at" timestamp with time zone,
	"first_scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episodes_site_url_unique" UNIQUE("site_url")
);
--> statement-breakpoint
CREATE TABLE "genres" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "genres_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "movie_actors" (
	"movie_id" integer NOT NULL,
	"actor_id" integer NOT NULL,
	CONSTRAINT "movie_actors_movie_id_actor_id_pk" PRIMARY KEY("movie_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "movie_countries" (
	"movie_id" integer NOT NULL,
	"country_id" integer NOT NULL,
	CONSTRAINT "movie_countries_movie_id_country_id_pk" PRIMARY KEY("movie_id","country_id")
);
--> statement-breakpoint
CREATE TABLE "movie_directors" (
	"movie_id" integer NOT NULL,
	"director_id" integer NOT NULL,
	CONSTRAINT "movie_directors_movie_id_director_id_pk" PRIMARY KEY("movie_id","director_id")
);
--> statement-breakpoint
CREATE TABLE "movie_genres" (
	"movie_id" integer NOT NULL,
	"genre_id" integer NOT NULL,
	CONSTRAINT "movie_genres_movie_id_genre_id_pk" PRIMARY KEY("movie_id","genre_id")
);
--> statement-breakpoint
CREATE TABLE "movies" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_url" text NOT NULL,
	"titre" text NOT NULL,
	"titre_original" text,
	"description" text,
	"annee" integer,
	"date_sortie" text,
	"duree" text,
	"note" real,
	"poster" text,
	"backdrop" text,
	"langue" text[],
	"qualite" text[],
	"version" text[],
	"categories" text[],
	"meta_hash" text,
	"popularity" integer DEFAULT 0 NOT NULL,
	"first_scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_meta_at" timestamp with time zone,
	"last_stream_at" timestamp with time zone,
	"deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "movies_site_url_unique" UNIQUE("site_url")
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "run_kind",
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"total" integer,
	"ok" integer,
	"errors" integer,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"series_id" integer NOT NULL,
	"number" integer NOT NULL,
	"titre" text,
	"episode_count" integer,
	"first_scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_series_id_number_unique" UNIQUE("series_id","number")
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_url" text NOT NULL,
	"titre" text NOT NULL,
	"titre_original" text,
	"description" text,
	"annee" integer,
	"note" real,
	"poster" text,
	"backdrop" text,
	"status" text,
	"meta_hash" text,
	"popularity" integer DEFAULT 0 NOT NULL,
	"first_scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_meta_at" timestamp with time zone,
	"last_stream_at" timestamp with time zone,
	"deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "series_site_url_unique" UNIQUE("site_url")
);
--> statement-breakpoint
CREATE TABLE "series_actors" (
	"series_id" integer NOT NULL,
	"actor_id" integer NOT NULL,
	CONSTRAINT "series_actors_series_id_actor_id_pk" PRIMARY KEY("series_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "series_creators" (
	"series_id" integer NOT NULL,
	"director_id" integer NOT NULL,
	CONSTRAINT "series_creators_series_id_director_id_pk" PRIMARY KEY("series_id","director_id")
);
--> statement-breakpoint
CREATE TABLE "series_genres" (
	"series_id" integer NOT NULL,
	"genre_id" integer NOT NULL,
	CONSTRAINT "series_genres_series_id_genre_id_pk" PRIMARY KEY("series_id","genre_id")
);
--> statement-breakpoint
CREATE TABLE "stream_direct" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"url" text NOT NULL,
	"protocol" "stream_protocol",
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"valid" boolean DEFAULT true NOT NULL,
	CONSTRAINT "stream_direct_source_url_unique" UNIQUE("source_id","url")
);
--> statement-breakpoint
CREATE TABLE "stream_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_kind" "entity_kind" NOT NULL,
	"entity_id" integer NOT NULL,
	"host" text,
	"iframe_url" text NOT NULL,
	"label" text,
	"version" text,
	"quality" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stream_sources_entity_iframe_unique" UNIQUE("entity_kind","entity_id","iframe_url")
);
--> statement-breakpoint
CREATE TABLE "url_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"kind" "url_kind",
	"parent_series_id" integer,
	"status" "queue_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone,
	CONSTRAINT "url_queue_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE INDEX "idx_actors_name" ON "actors" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_countries_name" ON "countries" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_directors_name" ON "directors" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_episodes_series" ON "episodes" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "idx_episodes_season" ON "episodes" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "idx_genres_name" ON "genres" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_movie_genres_genre" ON "movie_genres" USING btree ("genre_id");--> statement-breakpoint
CREATE INDEX "idx_movies_titre" ON "movies" USING btree ("titre");--> statement-breakpoint
CREATE INDEX "idx_movies_annee" ON "movies" USING btree ("annee");--> statement-breakpoint
CREATE INDEX "idx_movies_popularity" ON "movies" USING btree ("popularity");--> statement-breakpoint
CREATE INDEX "idx_movies_last_stream" ON "movies" USING btree ("last_stream_at");--> statement-breakpoint
CREATE INDEX "idx_seasons_series" ON "seasons" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "idx_series_titre" ON "series" USING btree ("titre");--> statement-breakpoint
CREATE INDEX "idx_series_annee" ON "series" USING btree ("annee");--> statement-breakpoint
CREATE INDEX "idx_series_popularity" ON "series" USING btree ("popularity");--> statement-breakpoint
CREATE INDEX "idx_series_genres_genre" ON "series_genres" USING btree ("genre_id");--> statement-breakpoint
CREATE INDEX "idx_stream_direct_source" ON "stream_direct" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_stream_direct_valid" ON "stream_direct" USING btree ("source_id") WHERE "stream_direct"."valid" = true;--> statement-breakpoint
CREATE INDEX "idx_stream_sources_entity" ON "stream_sources" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "idx_stream_sources_host" ON "stream_sources" USING btree ("host");--> statement-breakpoint
CREATE INDEX "idx_queue_status" ON "url_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_queue_kind" ON "url_queue" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_queue_parent_series" ON "url_queue" USING btree ("parent_series_id");