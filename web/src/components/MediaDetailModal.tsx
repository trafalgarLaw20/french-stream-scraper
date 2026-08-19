import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import type {
  EpisodeListItem,
  MovieDetail,
  SeriesDetail,
  StreamSourcePG,
} from "../types.js";
import { VideoPlayer } from "./VideoPlayer.js";

export interface MediaRef {
  kind: "movie" | "series";
  id: number;
  titre?: string | null;
  poster?: string | null;
}

export function MediaDetailModal({
  media,
  onClose,
}: {
  media: MediaRef;
  onClose: () => void;
}): JSX.Element {
  const [detail, setDetail] = useState<MovieDetail | SeriesDetail | null>(null);
  const [streams, setStreams] = useState<StreamSourcePG[] | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const pollTokenRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const refreshingRef = useRef(false);

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  /**
   * Lance un refresh des flux côté serveur puis suit son avancement en sondant
   * le statut toutes les 3 s ; à la fin, recharge les sources du film.
   * `auto=true` = déclenché à l'ouverture (flux tous expirés) — même logique,
   * le cooldown serveur protège du spam.
   */
  const triggerRefresh = useCallback(
    async (auto: boolean): Promise<void> => {
      if (refreshingRef.current) return;
      try {
        const r = await api.refreshMovieStreams(media.id);
        if (r.started) {
          setRefreshNote(
            auto ? "Flux expirés — rafraîchissement automatique en cours…" : "Rafraîchissement en cours…",
          );
        } else if (r.reason?.includes("déjà en cours")) {
          setRefreshNote("Un rafraîchissement est déjà en cours…");
        } else {
          // cooldown ou film introuvable : rien à suivre
          setRefreshNote(`Rafraîchissement non relancé : ${r.reason ?? "raison inconnue"}`);
          return;
        }
      } catch (e) {
        setRefreshNote(`Impossible de lancer le rafraîchissement : ${(e as Error).message}`);
        return;
      }

      refreshingRef.current = true;
      setRefreshing(true);
      const token = pollTokenRef.current;
      const deadline = Date.now() + 6 * 60 * 1000;
      while (!token.cancelled && Date.now() < deadline) {
        await sleep(3000);
        if (token.cancelled) return;
        let st;
        try {
          st = await api.movieRefreshStatus(media.id);
        } catch {
          continue; // erreur réseau passagère : on continue de sonder
        }
        if (!st.running && st.finishedAt) {
          const s = await api.catalogMovieStreams(media.id).catch(() => null);
          if (token.cancelled) return;
          if (s) setStreams(s.streams);
          setRefreshNote(
            st.ok
              ? "Flux rafraîchis ✓"
              : `Échec du rafraîchissement : ${st.error ?? "erreur inconnue"}`,
          );
          refreshingRef.current = false;
          setRefreshing(false);
          return;
        }
      }
      if (!token.cancelled) {
        refreshingRef.current = false;
        setRefreshing(false);
        setRefreshNote(
          "Le rafraîchissement prend plus de temps que prévu — réessaie dans quelques minutes.",
        );
      }
    },
    [media.id],
  );

  useEffect(() => {
    pollTokenRef.current.cancelled = true;
    const token = { cancelled: false };
    pollTokenRef.current = token;
    refreshingRef.current = false;
    setDetail(null);
    setStreams(null);
    setEpisodes(null);
    setError(null);
    setPlaying(null);
    setRefreshing(false);
    setRefreshNote(null);

    const loadDetail =
      media.kind === "movie"
        ? api.catalogMovie(media.id)
        : api.catalogSeriesDetail(media.id);

    Promise.all([
      loadDetail,
      media.kind === "movie"
        ? api.catalogMovieStreams(media.id)
        : Promise.resolve({ streams: [] as StreamSourcePG[] }),
      media.kind === "series"
        ? api.catalogSeriesEpisodes(media.id)
        : Promise.resolve({ items: [] as EpisodeListItem[] }),
    ])
      .then(([d, s, e]) => {
        setDetail(d);
        setStreams(s.streams);
        setEpisodes(e.items);
        // Auto-refresh : des sources existent mais aucun flux valide (liens
        // expirés ~12-48h) → on relance la résolution en arrière-plan.
        if (media.kind === "movie" && s.streams.length > 0) {
          const now = Date.now();
          const anyValid = s.streams.some((src) =>
            src.direct.some((x) => !x.expiresAt || new Date(x.expiresAt).getTime() > now),
          );
          if (!anyValid) void triggerRefresh(true);
        }
      })
      .catch((e) => setError((e as Error).message));

    return () => {
      token.cancelled = true;
    };
  }, [media, triggerRefresh]);

  // Fermeture par Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const isMovie = media.kind === "movie";
  const titre = detail?.titre ?? media.titre ?? "Chargement…";
  const poster = detail?.poster ?? media.poster ?? null;
  const backdrop = (detail as MovieDetail | undefined)?.backdrop ?? null;
  const genres = detail?.genres ?? [];
  const description = (detail as MovieDetail | SeriesDetail | null)?.description ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-2 sm:p-6"
      onClick={onClose}
    >
      <div
        className="card relative my-4 w-full max-w-4xl p-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Bouton close */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
          aria-label="Fermer"
        >
          ✕
        </button>

        {/* Backdrop / Poster */}
        <div className="relative aspect-video w-full overflow-hidden rounded-t-xl bg-slate-900">
          {backdrop ? (
            <img
              src={backdrop}
              alt=""
              className="h-full w-full object-cover opacity-70"
            />
          ) : poster ? (
            <img
              src={poster}
              alt=""
              className="h-full w-full object-cover opacity-70"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-500">
              pas d'image
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4">
            <div className="flex items-end gap-3">
              {poster && (
                <img
                  src={poster}
                  alt=""
                  className="hidden h-32 w-20 flex-shrink-0 rounded-md object-cover shadow-lg sm:block"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded bg-brand px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white">
                    {isMovie ? "Film" : "Série"}
                  </span>
                  {detail && "episodeCount" in detail && (
                    <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-200">
                      {detail.episodeCount} épisode{(detail.episodeCount ?? 0) > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <h2 className="truncate text-xl font-bold text-white">{titre}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300">
                  {detail?.annee && <span>{detail.annee}</span>}
                  {isMovie && detail && (detail as MovieDetail).duree && (
                    <span>• {(detail as MovieDetail).duree}</span>
                  )}
                  {detail?.note != null && (
                    <span>• ⭐ {detail.note.toFixed(1)}</span>
                  )}
                  {!isMovie && detail && (detail as SeriesDetail).status && (
                    <span>• {(detail as SeriesDetail).status}</span>
                  )}
                  {detail && detail.popularity > 0 && (
                    <span>• 👁 {detail.popularity} vues</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-4 sm:p-6">
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              Erreur : {error}
            </div>
          )}

          {!detail && !error && (
            <div className="text-sm text-slate-400">Chargement…</div>
          )}

          {/* Description + méta */}
          {detail && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                {genres.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {genres.map((g) => (
                      <span
                        key={g.id}
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      >
                        {g.name}
                      </span>
                    ))}
                  </div>
                )}
                {description && (
                  <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                    {description}
                  </p>
                )}
                {"acteurs" in detail && detail.acteurs && detail.acteurs.length > 0 && (
                  <div className="mt-3">
                    <h3 className="mb-1 text-xs font-semibold uppercase text-slate-400">
                      Acteurs
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {detail.acteurs.slice(0, 15).map((a) => a.name).join(", ")}
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-2 text-xs">
                {"titreOriginal" in detail && detail.titreOriginal && (
                  <Field label="Titre original" value={detail.titreOriginal} />
                )}
                {"dateSortie" in detail && detail.dateSortie && (
                  <Field label="Date de sortie" value={detail.dateSortie} />
                )}
                {"duree" in detail && detail.duree && (
                  <Field label="Durée" value={detail.duree} />
                )}
                {"qualite" in detail && detail.qualite && detail.qualite.length > 0 && (
                  <Field label="Qualité" value={detail.qualite.join(", ")} />
                )}
                {"version" in detail && detail.version && detail.version.length > 0 && (
                  <Field label="Version" value={detail.version.join(", ")} />
                )}
                {"langue" in detail && detail.langue && detail.langue.length > 0 && (
                  <Field label="Langue" value={detail.langue.join(", ")} />
                )}
                <Field
                  label="Scrapé le"
                  value={new Date(detail.firstScrapedAt).toLocaleDateString("fr-FR")}
                />
                {"lastStreamAt" in detail && detail.lastStreamAt && (
                  <Field
                    label="Streams MAJ"
                    value={new Date(detail.lastStreamAt).toLocaleDateString("fr-FR")}
                  />
                )}
              </div>
            </div>
          )}

          {/* Lecteur vidéo si un flux est sélectionné */}
          {playing && (
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase text-slate-400">
                  Lecteur
                </h3>
                <button
                  type="button"
                  onClick={() => setPlaying(null)}
                  className="text-xs text-slate-500 hover:text-red-600"
                >
                  Fermer lecteur
                </button>
              </div>
              <VideoPlayer src={playing} />
            </div>
          )}

          {/* Streams (films) — seules les sources fonctionnelles sont listées */}
          {isMovie && streams && streams.length > 0 && (() => {
            const now = Date.now();
            const liveSources = streams.filter((s) =>
              s.direct.some((d) => !d.expiresAt || new Date(d.expiresAt).getTime() > now),
            );
            const deadCount = streams.length - liveSources.length;
            return (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase text-slate-400">
                    Sources ({liveSources.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => void triggerRefresh(false)}
                    disabled={refreshing}
                    className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                  >
                    {refreshing ? "⏳ Rafraîchissement…" : "🔄 Rafraîchir les flux"}
                  </button>
                </div>
                {refreshNote && (
                  <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{refreshNote}</p>
                )}
                {liveSources.length > 0 ? (
                  <>
                    {deadCount > 0 && (
                      <p className="mb-2 text-xs text-slate-400">
                        🚫 {deadCount} source{deadCount > 1 ? "s" : ""} expirée
                        {deadCount > 1 ? "s" : ""} masquée
                        {deadCount > 1 ? "s" : ""} — « Rafraîchir les flux » les régénère.
                      </p>
                    )}
                    <div className="space-y-2">
                      {liveSources.map((s) => (
                        <StreamRow
                          key={s.id}
                          source={s}
                          onPlay={(url) => setPlaying(url)}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-400">
                    Tous les flux de ce film sont expirés — lance un rafraîchissement
                    pour les régénérer.
                  </p>
                )}
              </div>
            );
          })()}
          {isMovie && streams && streams.length === 0 && (
            <div className="space-y-2">
              <p className="text-sm text-slate-400">
                Aucun stream connu pour ce film — un rafraîchissement lancera la
                collecte et la résolution des flux.
              </p>
              {refreshNote && (
                <p className="text-xs text-slate-500 dark:text-slate-400">{refreshNote}</p>
              )}
              <button
                type="button"
                onClick={() => void triggerRefresh(false)}
                disabled={refreshing}
                className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
              >
                {refreshing ? "⏳ Rafraîchissement…" : "🔄 Rafraîchir les flux"}
              </button>
            </div>
          )}

          {/* Épisodes (séries) */}
          {!isMovie && episodes && episodes.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">
                Épisodes ({episodes.length})
              </h3>
              <div className="space-y-1">
                {episodes.map((ep) => (
                  <div
                    key={ep.id}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">Ép. {ep.number}</span>
                      {ep.titre && <span className="ml-2 text-slate-600 dark:text-slate-400">{ep.titre}</span>}
                    </div>
                    {ep.duree && (
                      <span className="ml-2 text-xs text-slate-500">{ep.duree}</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-400">
                La résolution des flux directs par épisode n'est pas encore
                disponible. Scrapera la page série pour découvrir les sources.
              </p>
            </div>
          )}
          {!isMovie && episodes && episodes.length === 0 && (
            <p className="text-sm text-slate-400">
              Aucun épisode connu. Re-scrape la série pour remplir cette liste.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex gap-2">
      <span className="w-24 flex-shrink-0 text-slate-400">{label}</span>
      <span className="flex-1 text-slate-700 dark:text-slate-300">{value}</span>
    </div>
  );
}

function StreamRow({
  source,
  onPlay,
}: {
  source: StreamSourcePG;
  onPlay: (url: string) => void;
}): JSX.Element {
  const valid = source.direct.filter(
    (d) => !d.expiresAt || new Date(d.expiresAt) > new Date(),
  );
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (url: string): void => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="font-mono text-xs text-slate-500">{source.host ?? "—"}</span>
          {source.label && (
            <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">
              {source.label}
            </span>
          )}
        </div>
        <span className="text-xs text-slate-400">
          {valid.length > 0
            ? `${valid.length} flux valide${valid.length > 1 ? "s" : ""}`
            : "aucun flux valide"}
        </span>
      </div>
      {valid.length === 0 ? (
        <p className="text-xs text-slate-400">
          Flux expiré ou absent — re-scrape le média pour régénérer.
        </p>
      ) : (
        <div className="space-y-1">
          {valid.map((d) => (
            <div
              key={d.url}
              className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1 dark:bg-slate-900"
            >
              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] uppercase text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {d.protocol ?? "?"}
              </span>
              <code className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-400">
                {d.url}
              </code>
              <button
                type="button"
                onClick={() => onPlay(d.url)}
                className="rounded bg-brand px-2 py-0.5 text-xs text-white hover:bg-brand/90"
              >
                ▶ Lire
              </button>
              <button
                type="button"
                onClick={() => copy(d.url)}
                className="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200"
              >
                {copied === d.url ? "✓" : "Copier"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
