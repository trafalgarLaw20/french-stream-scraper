import { useEffect, useRef, useState } from "react";
import { ScrapeForm } from "./components/ScrapeForm.js";
import { BatchForm } from "./components/BatchForm.js";
import { ProgressPanel } from "./components/ProgressPanel.js";
import { MovieCard } from "./components/MovieCard.js";
import { HistoryList } from "./components/HistoryList.js";
import { ExportBar } from "./components/ExportBar.js";
import { AdminView } from "./components/AdminView.js";
import { CatalogView } from "./components/CatalogView.js";
import { useSSE } from "./hooks/useSSE.js";
import { api } from "./api.js";
import type { MovieInfo } from "./types.js";

type Tab = "scraper" | "batch" | "catalog" | "history" | "admin";

function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  return [dark, () => setDark((d) => !d)];
}

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>("scraper");
  const [dark, toggleDark] = useTheme();
  const [jobId, setJobId] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const sse = useSSE(jobId);
  const movie: MovieInfo | null =
    sse.status === "done" && sse.events.some((e) => e.type === "done")
      ? (sse.events.find((e) => e.type === "done") as Extract<(typeof sse.events)[number], { type: "done" }>).movie
      : null;

  const movieId = movie ? jobId : null;

  const handleScrape = async (url: string, resolveStreams: boolean) => {
    setJobId(null);
    const { jobId: id } = await api.scrape(url, { resolveStreams });
    setJobId(id);
  };

  const refreshHistory = () => setHistoryKey((k) => k + 1);

  useEffect(() => {
    if (sse.status === "done") refreshHistory();
  }, [sse.status]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand font-bold text-white">
              FS
            </span>
            <h1 className="text-lg font-bold">Scraper UI</h1>
          </div>
          <nav className="flex items-center gap-1">
            <TabButton active={tab === "scraper"} onClick={() => setTab("scraper")}>
              Scraper
            </TabButton>
            <TabButton active={tab === "batch"} onClick={() => setTab("batch")}>
              Batch
            </TabButton>
            <TabButton active={tab === "catalog"} onClick={() => setTab("catalog")}>
              Catalogue
            </TabButton>
            <TabButton active={tab === "history"} onClick={() => setTab("history")}>
              Historique
            </TabButton>
            <TabButton active={tab === "admin"} onClick={() => setTab("admin")}>
              Admin
            </TabButton>
            <button
              onClick={toggleDark}
              className="ml-2 rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              title={dark ? "Mode clair" : "Mode sombre"}
            >
              {dark ? "☀" : "☾"}
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        {tab === "scraper" && (
          <>
            <ScrapeForm onSubmit={handleScrape} disabled={sse.status === "running"} />
            {jobId && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ProgressPanel events={sse.events} status={sse.status} />
                <div>
                  {movie && movieId && (
                    <>
                      <div className="mb-2 flex justify-end">
                        <ExportBar id={movieId} />
                      </div>
                      <MovieCard movie={movie} />
                    </>
                  )}
                  {!movie && sse.status === "running" && (
                    <div className="card flex h-full min-h-[300px] items-center justify-center text-slate-400">
                      Scraping en cours…
                    </div>
                  )}
                  {sse.status === "error" && (
                    <div className="card border-red-300 p-4 text-sm text-red-700 dark:border-red-800 dark:text-red-300">
                      {sse.error ?? "Une erreur est survenue pendant le scraping."}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {tab === "batch" && (
          <BatchView onDone={refreshHistory} />
        )}

        {tab === "catalog" && <CatalogView />}

        {tab === "history" && <HistoryList refreshKey={historyKey} />}

        {tab === "admin" && <AdminView />}
      </main>

      <footer className="mx-auto max-w-5xl px-4 py-6 text-center text-xs text-slate-400">
        Scraper UI — usage local uniquement. Les liens m3u8 expirent en ~48h.
      </footer>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-brand text-white"
          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

interface BatchJob {
  jobId: string;
  url: string;
}

function BatchView({ onDone }: { onDone: () => void }): JSX.Element {
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [results, setResults] = useState<Record<string, { status: string; movie?: MovieInfo }>>({});

  const batchRunning = jobs.length > 0 && Object.keys(results).length < jobs.length;

  const handleSubmit = async (urls: string[], resolveStreams: boolean) => {
    setResults({});
    setJobs([]);
    const { jobIds } = await api.batch(urls, { resolveStreams });
    const newJobs = jobIds.map((jobId, i) => ({ jobId, url: urls[i] ?? "" }));
    setJobs(newJobs);
  };

  return (
    <>
      <BatchForm onSubmit={handleSubmit} disabled={batchRunning} />
      {jobs.length > 0 && (
        <div className="space-y-3">
          {batchRunning && (
            <div className="card px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
              File séquentielle : un seul scrape à la fois, délai anti-ban de 4 s entre chaque.
            </div>
          )}
          {jobs.map((j) => (
            <BatchJobRow
              key={j.jobId}
              jobId={j.jobId}
              url={j.url}
              onDone={(movie) => {
                setResults((prev) =>
                  prev[j.jobId]
                    ? prev
                    : { ...prev, [j.jobId]: { status: "done", movie: movie ?? undefined } },
                );
                if (movie) onDone();
              }}
              result={results[j.jobId]?.movie}
            />
          ))}
        </div>
      )}
    </>
  );
}

function BatchJobRow({
  jobId,
  url,
  onDone,
  result,
}: {
  jobId: string;
  url: string;
  onDone: (movie: MovieInfo | null) => void;
  result?: MovieInfo;
}): JSX.Element {
  const sse = useSSE(jobId);
  const doneCalled = useRef(false);
  const movie: MovieInfo | null =
    sse.status === "done"
      ? (sse.events.find((e) => e.type === "done") as Extract<(typeof sse.events)[number], { type: "done" }> | undefined)?.movie ?? null
      : null;

  useEffect(() => {
    if (doneCalled.current) return;
    if (sse.status === "done" || sse.status === "error") {
      doneCalled.current = true;
      onDone(movie);
    }
  }, [sse.status, movie, onDone]);

  const waiting = sse.status === "running" && sse.events.length === 0;

  return (
    <div className="card p-3">
      <div className="mb-2 truncate text-xs text-slate-500" title={url}>
        {url}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ProgressPanel events={sse.events} status={sse.status} />
        <div>
          {waiting && (
            <p className="text-xs text-slate-400">En file d'attente (séquentiel)…</p>
          )}
          {(movie ?? result) && <MovieCard movie={(movie ?? result)!} />}
          {sse.status === "error" && (
            <p className="text-sm text-red-600">{sse.error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
