import { useEffect, useState } from "react";
import { api } from "../api.js";
import type { HistoryItem, MovieInfo } from "../types.js";
import { MovieCard } from "./MovieCard.js";

export function HistoryList({ refreshKey }: { refreshKey: number }): JSX.Element {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MovieInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .history(query)
      .then((r) => setItems(r.items))
      .finally(() => setLoading(false));
  }, [query, refreshKey]);

  const open = async (id: string) => {
    const movie = await api.historyItem(id);
    setSelected(movie);
  };

  const remove = async (id: string) => {
    await api.deleteHistory(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    setSelected(null);
  };

  if (selected) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <button onClick={() => setSelected(null)} className="btn-ghost !text-xs">
            ← Retour à l'historique
          </button>
          <div className="flex gap-2">
            <a href={api.exportUrl(selected.url ? items.find((i) => i.url === selected!.url)?.id ?? "" : "", "json")} className="btn-ghost !text-xs">
              Export JSON
            </a>
            <button onClick={() => remove(items.find((i) => i.url === selected!.url)?.id ?? "")} className="btn-ghost !text-xs text-red-600">
              Supprimer
            </button>
          </div>
        </div>
        <MovieCard movie={selected} />
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-semibold">Historique ({items.length})</h3>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher…"
          className="input max-w-xs !py-1.5 !text-sm"
        />
      </div>

      {loading && <p className="py-8 text-center text-slate-400">Chargement…</p>}
      {!loading && items.length === 0 && (
        <p className="py-8 text-center text-slate-400">Aucun scrape pour le moment.</p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => open(item.id)}
            className="group text-left"
          >
            <div className="aspect-[2/3] overflow-hidden rounded-lg bg-slate-200 shadow-sm dark:bg-slate-800">
              {item.poster ? (
                <img
                  src={item.poster}
                  alt={item.titre ?? ""}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-slate-400">Pas d'image</div>
              )}
            </div>
            <p className="mt-1.5 truncate text-sm font-medium">{item.titre ?? "Sans titre"}</p>
            <p className="text-xs text-slate-400">{item.annee ?? "—"}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
