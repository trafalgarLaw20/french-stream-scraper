import { useMemo, useState } from "react";
import type { LangueCode, LangueInfo, StreamSource } from "../types.js";
import { VideoPlayer } from "./VideoPlayer.js";

const LANGUES: Record<LangueCode, LangueInfo> = {
  VOSTFR: { code: "VOSTFR", libelle: "VOSTFR", drapeau: "🌐" },
  "VF-FR": { code: "VF-FR", libelle: "VF France", drapeau: "🇫🇷" },
  "VF-QC": { code: "VF-QC", libelle: "VF Québec", drapeau: "🇨🇦" },
  DEFAUT: { code: "DEFAUT", libelle: "Par défaut", drapeau: "❔" },
  AUTRE: { code: "AUTRE", libelle: "Autre", drapeau: "❔" },
};

const LANG_ORDER: LangueCode[] = ["VOSTFR", "VF-FR", "VF-QC", "DEFAUT", "AUTRE"];

export function detectLangue(label: string | null): LangueCode {
  if (!label) return "AUTRE";
  const l = label.toUpperCase();
  if (/\bVFF\b|TRUEFRENCH|TRUE\s*FRENCH|VF1\b/.test(l)) return "VF-FR";
  if (/\bVFQ\b|\bFRENCH\b/.test(l)) return "VF-QC";
  if (/\bVOSTFR\b|\bVOST\b|\bVO\b/.test(l)) return "VOSTFR";
  if (/\(D[ÉE]FAUT\)|D[ÉE]FAUT/.test(l)) return "DEFAUT";
  return "AUTRE";
}

export function SourceList({ sources }: { sources: StreamSource[] }): JSX.Element {
  const [active, setActive] = useState<LangueCode | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const byLangue = useMemo(() => {
    const map = new Map<LangueCode, StreamSource[]>();
    for (const s of sources) {
      const code = detectLangue(s.label);
      const arr = map.get(code) ?? [];
      arr.push(s);
      map.set(code, arr);
    }
    return map;
  }, [sources]);

  const languesDispo = useMemo(
    () => LANG_ORDER.filter((c) => byLangue.has(c)),
    [byLangue],
  );

  const current = active ?? languesDispo[0] ?? null;
  const currentSources = current ? byLangue.get(current) ?? [] : [];

  const streams = currentSources.filter((s) => Boolean(s.streamDirect));
  const iframes = currentSources.filter((s) => !s.streamDirect);

  return (
    <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
      <h3 className="mb-3 font-semibold">Sources vidéo</h3>

      <div className="mb-4 flex flex-wrap gap-2">
        {languesDispo.map((code) => {
          const info = LANGUES[code];
          const list = byLangue.get(code) ?? [];
          const playable = list.filter((s) => s.streamDirect).length;
          const isActive = current === code;
          return (
            <button
              key={code}
              onClick={() => {
                setActive(code);
                setPlaying(null);
              }}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "border-brand bg-brand text-white shadow-sm"
                  : "border-slate-300 bg-white text-slate-700 hover:border-brand/50 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              <span>{info.drapeau}</span>
              <span>{info.libelle}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  isActive
                    ? "bg-white/25 text-white"
                    : playable > 0
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                }`}
                title={`${list.length} source(s), ${playable} lisible(s)`}
              >
                {list.length}
              </span>
            </button>
          );
        })}
      </div>

      {currentSources.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-400 dark:border-slate-700">
          Aucune source.
        </p>
      ) : (
        <div className="space-y-3">
          <details open className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
              <span className="transition-transform group-open:rotate-90">▸</span>
              Flux directs — lisibles immédiatement
              <span className="ml-auto rounded-full bg-emerald-200 px-2 py-0.5 text-xs dark:bg-emerald-900/50">
                {streams.length}
              </span>
            </summary>
            <div className="mt-2 space-y-2">
              {streams.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-center text-xs text-slate-400 dark:border-slate-700">
                  Aucun flux direct pour {LANGUES[current!].libelle} sur ce film.
                </p>
              )}
              {streams.map((s, i) => {
                const key = `stream-${s.url}-${i}`;
                const isPlaying = playing === key;
                return (
                  <SourceRow
                    key={key}
                    source={s}
                    variant="stream"
                    isPlaying={isPlaying}
                    onTogglePlay={() => setPlaying(isPlaying ? null : key)}
                  >
                    {isPlaying && s.streamDirect && (
                      <div className="mt-3">
                        <VideoPlayer src={s.streamDirect} />
                      </div>
                    )}
                  </SourceRow>
                );
              })}
            </div>
          </details>

          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              <span className="transition-transform group-open:rotate-90">▸</span>
              Liens iframe — embeds hébergeurs
              <span className="ml-auto rounded-full bg-slate-300 px-2 py-0.5 text-xs dark:bg-slate-700">
                {iframes.length}
              </span>
            </summary>
            <div className="mt-2 space-y-2">
              {iframes.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-center text-xs text-slate-400 dark:border-slate-700">
                  Aucun lien iframe pour {LANGUES[current!].libelle}.
                </p>
              )}
              {iframes.map((s, i) => {
                const key = `iframe-${s.url}-${i}`;
                return <SourceRow key={key} source={s} variant="iframe" />;
              })}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function SourceRow({
  source,
  variant,
  isPlaying,
  onTogglePlay,
  children,
}: {
  source: StreamSource;
  variant: "stream" | "iframe";
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  children?: React.ReactNode;
}): JSX.Element {
  const isStream = variant === "stream";
  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        isPlaying
          ? "border-brand bg-brand/5"
          : isStream
            ? "border-emerald-200 dark:border-emerald-900/50"
            : "border-slate-200 dark:border-slate-800"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {source.host && (
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                  isStream
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {source.host}
              </span>
            )}
            {source.label && <span className="text-sm font-medium">{source.label}</span>}
            {isStream ? (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                ▶ m3u8
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded bg-slate-400 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                embed
              </span>
            )}
          </div>
          <p
            className="mt-0.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400"
            title={isStream ? source.streamDirect! : source.url}
          >
            {isStream ? source.streamDirect : source.url}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {isStream && (
            <button onClick={onTogglePlay} className="btn-primary !px-3 !py-1.5 !text-xs">
              {isPlaying ? "Arrêter" : "Lire"}
            </button>
          )}
          <CopyButton
            text={isStream ? source.streamDirect! : source.url}
            label={isStream ? "m3u8" : "iframe"}
          />
        </div>
      </div>
      {children}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore */
        }
      }}
      className="btn-ghost !px-3 !py-1.5 !text-xs"
    >
      {copied ? "✓ Copié" : `Copier ${label}`}
    </button>
  );
}
