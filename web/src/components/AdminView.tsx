import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import type {
  AdminStatus,
  JobKind,
  MovieListItem,
  ScrapeRun,
} from "../types.js";

const JOBS: { kind: JobKind; label: string; desc: string; icon: string }[] = [
  { kind: "discover", label: "Discover", desc: "Rescanne le catalogue (nouveautés)", icon: "🔍" },
  { kind: "metadata", label: "Metadata", desc: "Refresh métadonnées (skip si inchangées)", icon: "📝" },
  { kind: "stream", label: "Stream Top", desc: "Refresh .m3u8 des 100 + populaires", icon: "🎬" },
  { kind: "full-stream", label: "Full Stream", desc: "Refresh complet hebdo (lent)", icon: "🌐" },
];

function fmtDuration(ms: number | null | undefined): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function AdminView(): JSX.Element {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [runs, setRuns] = useState<ScrapeRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string>(() => localStorage.getItem("adminToken") ?? "");
  const [tokenInput, setTokenInput] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [triggering, setTriggering] = useState<JobKind | null>(null);
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [s, r] = await Promise.all([api.adminStatus(), api.adminRuns(20)]);
      setStatus(s);
      setRuns(r.runs);
    } catch (e) {
      setError((e as Error).message);
      if ((e as Error).message.includes("401")) {
        setStatus(null);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    void refresh();
  }, [token, refresh]);

  // Auto-refresh 5s quand un job est en cours
  useEffect(() => {
    if (!autoRefresh || !status?.currentJob) return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [autoRefresh, status?.currentJob, refresh]);

  const saveToken = (): void => {
    localStorage.setItem("adminToken", tokenInput);
    setToken(tokenInput);
    setTokenInput("");
  };

  const clearToken = (): void => {
    localStorage.removeItem("adminToken");
    setToken("");
    setStatus(null);
    setRuns([]);
  };

  const trigger = async (kind: JobKind): Promise<void> => {
    setTriggering(kind);
    setTriggerMsg(null);
    try {
      const r = await api.adminCrawl(kind);
      setTriggerMsg(r.ran ? `✓ ${kind} démarré` : `✗ ${r.reason ?? "déjà en cours"}`);
      setTimeout(() => void refresh(), 500);
    } catch (e) {
      setTriggerMsg(`✗ ${(e as Error).message}`);
    } finally {
      setTriggering(null);
    }
  };

  // Pas de token configuré → afficher le form
  if (!token) {
    return (
      <div className="card p-6">
        <h2 className="mb-2 text-lg font-semibold">Configuration admin</h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Pour piloter le scheduler et la queue, entre le token admin configuré
          dans <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.env</code> (variable{" "}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">ADMIN_API_TOKEN</code>).
        </p>
        <input
          type="password"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="Token admin (X-Admin-Token)"
          className="input mb-3"
          onKeyDown={(e) => e.key === "Enter" && saveToken()}
        />
        <button
          type="button"
          className="btn-primary"
          onClick={saveToken}
          disabled={!tokenInput.trim()}
        >
          Se connecter
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header admin */}
      <div className="card flex items-center justify-between p-3">
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Token : <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{token.slice(0, 4)}…{token.slice(-4)}</code>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="h-3 w-3 accent-brand"
            />
            Auto-refresh
          </label>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
            disabled={refreshing}
          >
            {refreshing ? "…" : "↻ Refresh"}
          </button>
          <button
            type="button"
            onClick={clearToken}
            className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          >
            Déconnexion
          </button>
        </div>
      </div>

      {error && (
        <div className="card border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Job en cours + Queue */}
      {status && (
        <>
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                État
              </h2>
              <div>
                {status.currentJob ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                    Job en cours : {status.currentJob}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Idle
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2 text-center">
              {(["pending", "running", "done", "error", "stale"] as const).map((k) => (
                <div
                  key={k}
                  className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900"
                >
                  <div className="text-2xl font-bold tabular-nums">
                    {status.queue[k] ?? 0}
                  </div>
                  <div className="text-xs uppercase text-slate-500 dark:text-slate-400">
                    {k}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Déclenchement jobs */}
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Déclencher un job
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {JOBS.map((j) => {
                const disabled = !!status.currentJob || triggering !== null;
                return (
                  <button
                    key={j.kind}
                    type="button"
                    onClick={() => void trigger(j.kind)}
                    disabled={disabled}
                    className="flex flex-col items-start gap-1 rounded-lg border border-slate-200 p-3 text-left transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span>{j.icon}</span>
                      {triggering === j.kind ? "…" : j.label}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {j.desc}
                    </div>
                  </button>
                );
              })}
            </div>
            {triggerMsg && (
              <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                {triggerMsg}
              </div>
            )}
          </div>

          {/* Runs récents */}
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Runs récents
            </h2>
            {runs.length === 0 ? (
              <p className="text-sm text-slate-400">Aucun run pour l'instant.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-slate-400">
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Kind</th>
                      <th className="py-2 pr-3">Début</th>
                      <th className="py-2 pr-3">Durée</th>
                      <th className="py-2 pr-3 text-right">Total</th>
                      <th className="py-2 pr-3 text-right">OK</th>
                      <th className="py-2 pr-3 text-right">Err</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-2 pr-3 tabular-nums text-slate-400">{r.id}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{r.kind}</td>
                        <td className="py-2 pr-3 text-xs">{fmtDate(r.startedAt)}</td>
                        <td className="py-2 pr-3 tabular-nums">
                          {r.finishedAt ? fmtDuration(r.durationMs) : <em className="text-amber-600">en cours…</em>}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.total ?? "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-emerald-600">{r.ok ?? "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-red-600">{r.errors ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Catalogue PostgreSQL */}
          <CatalogBrowser />
        </>
      )}
    </div>
  );
}

// ─── Catalogue PG : paginé, recherche, genres ───────────────────────────

function CatalogBrowser(): JSX.Element {
  const [items, setItems] = useState<MovieListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (reset = false) => {
    setLoading(true);
    try {
      const r = await api.catalogMovies({
        cursor: reset ? undefined : cursor ?? undefined,
        limit: 24,
        q: q.trim() || undefined,
      });
      if (reset) {
        setItems(r.items);
        setCursor(null);
      } else {
        setItems((prev) => [...prev, ...r.items]);
      }
      setNextCursor(r.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [cursor, q]);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Catalogue PostgreSQL
        </h2>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher…"
          className="input max-w-xs"
        />
      </div>

      {items.length === 0 && !loading ? (
        <p className="text-sm text-slate-400">
          Aucun film. Lance un discover + metadata pour remplir la DB.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {items.map((m) => (
            <a
              key={m.id}
              href={`https://french-stream.one${m.id > 0 ? "" : ""}`}
              onClick={(e) => e.preventDefault()}
              className="group block overflow-hidden rounded-lg bg-slate-50 dark:bg-slate-900"
              title={`${m.titre ?? "—"} (${m.annee ?? "—"})`}
            >
              {m.poster ? (
                <img
                  src={m.poster}
                  alt={m.titre ?? ""}
                  loading="lazy"
                  className="aspect-[2/3] w-full object-cover"
                />
              ) : (
                <div className="flex aspect-[2/3] w-full items-center justify-center text-xs text-slate-400">
                  pas d'image
                </div>
              )}
              <div className="p-1.5">
                <div className="truncate text-xs font-medium">{m.titre ?? "—"}</div>
                <div className="text-xs text-slate-400">{m.annee ?? "—"}</div>
              </div>
            </a>
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="mt-4 text-center">
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setCursor(nextCursor);
              void load(false);
            }}
            disabled={loading}
          >
            {loading ? "Chargement…" : "Charger plus"}
          </button>
        </div>
      )}
    </div>
  );
}
