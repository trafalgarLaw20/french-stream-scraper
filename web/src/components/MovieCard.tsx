import type { MovieInfo } from "../types.js";
import { SourceList } from "./SourceList.js";

export function MovieCard({ movie }: { movie: MovieInfo }): JSX.Element {
  return (
    <div className="card overflow-hidden">
      {movie.backdrop && (
        <div className="relative h-48 w-full sm:h-64">
          <img
            src={movie.backdrop}
            alt={movie.titre ?? "backdrop"}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
            <div className="flex flex-wrap items-end gap-3">
              {movie.poster && (
                <img
                  src={movie.poster}
                  alt=""
                  className="hidden sm:block h-28 w-20 rounded-md object-cover shadow-lg ring-1 ring-white/20"
                  loading="lazy"
                />
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold drop-shadow sm:text-2xl">{movie.titre ?? "Sans titre"}</h2>
                {movie.titreOriginal && movie.titreOriginal !== movie.titre && (
                  <p className="text-sm text-white/70">{movie.titreOriginal}</p>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80">
                  {movie.annee && <span>{movie.annee}</span>}
                  {movie.duree && <span>• {movie.duree}</span>}
                  {movie.qualite.map((q) => (
                    <span key={q} className="rounded bg-white/20 px-1.5 py-0.5 text-xs font-medium">
                      {q}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 sm:p-5">
        {!movie.backdrop && (
          <div className="mb-4">
            <h2 className="text-xl font-bold sm:text-2xl">{movie.titre ?? "Sans titre"}</h2>
            {movie.titreOriginal && movie.titreOriginal !== movie.titre && (
              <p className="text-sm text-slate-500 dark:text-slate-400">{movie.titreOriginal}</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
              {movie.annee && <span>{movie.annee}</span>}
              {movie.duree && <span>• {movie.duree}</span>}
              {movie.qualite.map((q) => (
                <span key={q} className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium dark:bg-slate-800">
                  {q}
                </span>
              ))}
            </div>
          </div>
        )}

        {movie.genres.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {movie.genres.map((g) => (
              <span
                key={g}
                className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand-dark dark:text-brand"
              >
                {g}
              </span>
            ))}
          </div>
        )}

        {movie.description && (
          <p className="mb-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{movie.description}</p>
        )}

        <dl className="mb-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {movie.realisation.length > 0 && <Field label="Réalisation" value={movie.realisation.join(", ")} />}
          {movie.acteurs.length > 0 && <Field label="Acteurs" value={movie.acteurs.slice(0, 6).join(", ")} />}
          {movie.dateSortie && <Field label="Date de sortie" value={movie.dateSortie} />}
          {movie.langue.length > 0 && <Field label="Langue" value={movie.langue.join(", ")} />}
          {movie.pays.length > 0 && <Field label="Pays" value={movie.pays.join(", ")} />}
          {movie.note !== null && <Field label="Note" value={`${movie.note} / 10`} />}
        </dl>

        {movie.iframes.length > 0 && <SourceList sources={movie.iframes} />}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 font-medium text-slate-500 dark:text-slate-400">{label}:</dt>
      <dd className="text-slate-800 dark:text-slate-200">{value}</dd>
    </div>
  );
}
