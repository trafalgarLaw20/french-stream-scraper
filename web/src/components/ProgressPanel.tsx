import { useEffect, useRef } from "react";
import type { ScrapeEvent } from "../types.js";

const LABELS: Partial<Record<ScrapeEvent["type"], string>> = {
  start: "Démarrage",
  "fetch:start": "Chargement de la page",
  "fetch:cf": "Contournement Cloudflare",
  "fetch:retry": "Relance de la navigation",
  "fetch:done": "Page chargée",
  "players:start": "Recherche des lecteurs",
  "players:click": "Clic sur un lecteur",
  "iframe:found": "Lecteur détecté",
  "players:done": "Lecteurs collectés",
  "parse:done": "Métadonnées extraites",
  "resolve:start": "Résolution du flux",
  "resolve:candidate": "Flux candidat trouvé",
  "resolve:done": "Flux résolu",
  "resolve:all:done": "Résolution terminée",
  done: "Terminé",
  error: "Erreur",
};

const STEP_ORDER: ScrapeEvent["type"][] = [
  "start",
  "fetch:start",
  "fetch:cf",
  "fetch:done",
  "players:start",
  "players:click",
  "iframe:found",
  "players:done",
  "parse:done",
  "resolve:start",
  "resolve:done",
  "resolve:all:done",
  "done",
];

function stepIndex(type: ScrapeEvent["type"]): number {
  const i = STEP_ORDER.indexOf(type);
  return i === -1 ? 99 : i;
}

export function ProgressPanel({ events, status }: { events: ScrapeEvent[]; status: string }): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  const lastStep = events.reduce((acc, e) => Math.max(acc, stepIndex(e.type)), -1);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Progression</h3>
        <StatusBadge status={status} />
      </div>

      <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className={`h-full transition-all duration-500 ${
            status === "error" ? "bg-red-500" : status === "done" ? "bg-emerald-500" : "bg-brand"
          }`}
          style={{ width: `${Math.min(100, ((lastStep + 1) / STEP_ORDER.length) * 100)}%` }}
        />
      </div>

      <div ref={scrollRef} className="max-h-72 space-y-1.5 overflow-y-auto font-mono text-xs">
        {events.length === 0 && (
          <p className="text-slate-400 italic">En attente d'événements…</p>
        )}
        {events.map((e, i) => (
          <EventLine key={i} event={e} />
        ))}
      </div>
    </div>
  );
}

function EventLine({ event }: { event: ScrapeEvent }): JSX.Element {
  const label = LABELS[event.type] ?? event.type;
  let detail = "";
  if (event.type === "fetch:cf") detail = `"${event.title}"`;
  else if (event.type === "players:click") detail = event.player;
  else if (event.type === "iframe:found") detail = event.label ?? event.host ?? "";
  else if (event.type === "players:start") detail = `${event.count} boutons`;
  else if (event.type === "players:done") detail = `${event.total} sources`;
  else if (event.type === "resolve:start") detail = event.host ?? "";
  else if (event.type === "resolve:done") detail = event.streamDirect ? "flux trouvé" : "aucun flux";
  else if (event.type === "error") detail = event.message;

  const isErr = event.type === "error";
  const isOk = event.type === "done";

  return (
    <div className={`flex items-start gap-2 ${isErr ? "text-red-500" : isOk ? "text-emerald-500" : ""}`}>
      <span className="text-slate-400 select-none">›</span>
      <span className="font-medium">{label}</span>
      {detail && <span className="text-slate-400 truncate">{detail}</span>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const map: Record<string, string> = {
    idle: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    running: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${map[status] ?? map.idle}`}>
      {status === "running" ? "en cours" : status}
    </span>
  );
}
