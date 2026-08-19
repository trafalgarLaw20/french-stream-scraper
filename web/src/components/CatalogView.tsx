import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import type {
  GenreFacet,
  MovieListItem,
  Paginated,
  SeriesListItem,
  SortKey,
  YearFacet,
} from "../types.js";
import { MediaDetailModal, type MediaRef } from "./MediaDetailModal.js";

type Kind = "movie" | "series";

interface MediaItem {
  id: number;
  titre: string | null;
  annee: number | null;
  poster: string | null;
  backdrop: string | null;
  note: number | null;
  popularity: number;
}

function adaptMovie(m: MovieListItem): MediaItem {
  return {
    id: m.id,
    titre: m.titre,
    annee: m.annee,
    poster: m.poster,
    backdrop: m.backdrop,
    note: m.note,
    popularity: m.popularity,
  };
}

function adaptSeries(s: SeriesListItem): MediaItem {
  return {
    id: s.id,
    titre: s.titre,
    annee: s.annee,
    poster: s.poster,
    backdrop: s.backdrop,
    note: s.note,
    popularity: s.popularity,
  };
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Plus récents" },
  { key: "popular", label: "Populaires" },
  { key: "title", label: "Titre (A→Z)" },
  { key: "year", label: "Année" },
];

export function CatalogView(): JSX.Element {
  const [kind, setKind] = useState<Kind>("movie");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [genreFilter, setGenreFilter] = useState<string>("");
  const [yearFilter, setYearFilter] = useState<string>("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genres, setGenres] = useState<GenreFacet[]>([]);
  const [years, setYears] = useState<YearFacet[]>([]);
  const [selected, setSelected] = useState<MediaRef | null>(null);

  // Debounce recherche
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(id);
  }, [q]);

  // Charge les facets une fois
  useEffect(() => {
    Promise.all([api.catalogGenres(), api.catalogYears()])
      .then(([g, y]) => {
        setGenres(g.items);
        setYears(y.items);
      })
      .catch(() => undefined);
  }, []);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let r: Paginated<MovieListItem | SeriesListItem>;
      if (kind === "movie") {
        r = await api.catalogMovies({
          limit: 30,
          q: debouncedQ || undefined,
          genre: genreFilter || undefined,
          year: yearFilter ? Number(yearFilter) : undefined,
        });
        setItems((r as Paginated<MovieListItem>).items.map(adaptMovie));
      } else {
        r = await api.catalogSeries({
          limit: 30,
          q: debouncedQ || undefined,
        });
        setItems((r as Paginated<SeriesListItem>).items.map(adaptSeries));
      }
      setNextCursor(r.nextCursor);
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, [kind, debouncedQ, genreFilter, yearFilter]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = async (): Promise<void> => {
    if (!nextCursor || loading) return;
    setLoading(true);
    try {
      if (kind === "movie") {
        const r = await api.catalogMovies({
          cursor: nextCursor,
          limit: 30,
          q: debouncedQ || undefined,
          genre: genreFilter || undefined,
          year: yearFilter ? Number(yearFilter) : undefined,
        });
        setItems((prev) => [...prev, ...r.items.map(adaptMovie)]);
        setNextCursor(r.nextCursor);
      } else {
        const r = await api.catalogSeries({
          cursor: nextCursor,
          limit: 30,
          q: debouncedQ || undefined,
        });
        setItems((prev) => [...prev, ...r.items.map(adaptSeries)]);
        setNextCursor(r.nextCursor);
      }
    } catch (e) {
      // On garde les éléments déjà chargés ; l'erreur est simplement remontée.
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const sorted = useMemo(() => {
    const arr = [...items];
    switch (sort) {
      case "popular":
        return arr.sort((a, b) => b.popularity - a.popularity);
      case "title":
        return arr.sort((a, b) => (a.titre ?? "").localeCompare(b.titre ?? ""));
      case "year":
        return arr.sort((a, b) => (b.annee ?? 0) - (a.annee ?? 0));
      case "recent":
      default:
        // L'ordre par défaut du curseur (id DESC) = récents d'abord
        return arr;
    }
  }, [items, sort]);

  const open = (m: MediaItem): void => {
    setSelected({
      kind,
      id: m.id,
      titre: m.titre,
      poster: m.poster,
    });
  };

  const resetFilters = (): void => {
    setQ("");
    setDebouncedQ("");
    setGenreFilter("");
    setYearFilter("");
    setSort("recent");
  };

  const hasFilters = debouncedQ || genreFilter || yearFilter || sort !== "recent";

  return (
    <div className="space-y-4">
      {/* Type media + recherche */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setKind("movie")}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                kind === "movie"
                  ? "bg-white text-brand shadow dark:bg-slate-700"
                  : "text-slate-500"
              }`}
            >
              🎬 Films
            </button>
            <button
              type="button"
              onClick={() => setKind("series")}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                kind === "series"
                  ? "bg-white text-brand shadow dark:bg-slate-700"
                  : "text-slate-500"
              }`}
            >
              📺 Séries
            </button>
          </div>

          <div className="relative flex-1 min-w-[200px]">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Rechercher un ${kind === "movie" ? "film" : "série"}…`}
              className="input pl-8"
            />
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              🔍
            </span>
          </div>

          {hasFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              ✕ Réinitialiser
            </button>
          )}
        </div>

        {/* Filtres secondaires */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {kind === "movie" && genres.length > 0 && (
            <select
              value={genreFilter}
              onChange={(e) => setGenreFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="">Tous les genres</option>
              {genres.map((g) => (
                <option key={g.id} value={g.name}>
                  {g.name} ({g.count})
                </option>
              ))}
            </select>
          )}

          {kind === "movie" && years.length > 0 && (
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="">Toutes les années</option>
              {years.map((y) => (
                <option key={y.annee} value={String(y.annee)}>
                  {y.annee} ({y.count})
                </option>
              ))}
            </select>
          )}

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                Tri : {s.label}
              </option>
            ))}
          </select>

          <span className="ml-auto text-xs text-slate-400">
            {sorted.length} résultat{sorted.length > 1 ? "s" : ""}
            {nextCursor && " (page 1)"}
          </span>
        </div>
      </div>

      {/* Erreur */}
      {error && (
        <div className="card border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Grille */}
      {!error && sorted.length === 0 && !loading && (
        <div className="card p-8 text-center text-sm text-slate-400">
          Aucun média trouvé.
          <br />
          {!debouncedQ && !genreFilter && !yearFilter && (
            <>
              Lance un job <strong>Discover</strong> + <strong>Metadata</strong>{" "}
              depuis l'onglet Admin pour remplir le catalogue.
            </>
          )}
        </div>
      )}

      {sorted.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {sorted.map((m) => (
            <PosterCard key={`${kind}-${m.id}`} media={m} onClick={() => open(m)} />
          ))}
        </div>
      )}

      {/* Load more */}
      {nextCursor && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="btn-primary"
          >
            {loading ? "Chargement…" : "Charger plus"}
          </button>
        </div>
      )}

      {/* Modal détail */}
      {selected && (
        <MediaDetailModal
          media={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function PosterCard({
  media,
  onClick,
}: {
  media: MediaItem;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="group relative block w-full overflow-hidden rounded-lg bg-slate-100 text-left transition-transform hover:scale-105 hover:shadow-lg dark:bg-slate-800"
    >
      {media.poster ? (
        <img
          src={media.poster}
          alt={media.titre ?? ""}
          loading="lazy"
          className="aspect-[2/3] w-full object-cover"
        />
      ) : (
        <div className="flex aspect-[2/3] w-full items-center justify-center bg-slate-200 p-2 text-center text-xs text-slate-500 dark:bg-slate-700">
          {media.titre ?? "—"}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
        <div className="truncate text-xs font-medium text-white">{media.titre ?? "—"}</div>
        <div className="text-[10px] text-slate-300">
          {media.annee ?? "—"}
          {media.note != null && ` • ⭐ ${media.note.toFixed(1)}`}
        </div>
      </div>
    </button>
  );
}
