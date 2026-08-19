import type { Browser } from "playwright";
import type { ProgressFn, StreamSource } from "./schema.js";
import { detectLangue } from "./langue.js";
import { resolveIframeToStream } from "./extractors/index.js";

function log(verbose: boolean | undefined, msg: string): void {
  if (verbose) console.error(`[resolver] ${msg}`);
}

// Clé de dédup : hôte + langue + 1er segment de chemin. Deux sources du même
// hôte mais de langues différentes (ex. « ViDZY VOSTFR » vs « ViDZY VFQ »)
// doivent être résolues séparément, sinon on réutilisait à tort le flux d'une
// langue pour l'autre. Le segment de chemin distingue les passerelles
// multi-hébergeurs (ex. kakaflix.lol/doodz vs /voe3 vs /moon2) qui exposent
// des players différents sous un même domaine.
function dedupKey(host: string | null, label: string | null, url: string): string {
  let pathSegment = "";
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean)[0] ?? "";
    pathSegment = seg;
  } catch {
    /* URL invalide : clé sans segment */
  }
  return `${host ?? "?"}|${pathSegment}|${detectLangue(label)}`;
}

async function resolveOne(
  browser: Browser,
  src: StreamSource,
  timeoutMs: number,
  verbose?: boolean,
  onProgress?: ProgressFn,
): Promise<StreamSource> {
  if (!/^https?:\/\//.test(src.url)) return { ...src, streamDirect: null };

  log(verbose, `Résolution iframe: ${src.url}`);
  onProgress?.({ type: "resolve:start", url: src.url, host: src.host });

  const direct = await resolveIframeToStream(browser, src.url, {
    timeoutMs,
    verbose,
    onProgress,
  });

  log(verbose, direct ? `Flux retenu: ${direct}` : `Aucun flux pour ${src.url}`);
  onProgress?.({ type: "resolve:done", url: src.url, streamDirect: direct });
  return { ...src, streamDirect: direct };
}

export async function resolveStreams(
  browser: Browser,
  sources: StreamSource[],
  opts: { timeoutMs?: number; verbose?: boolean; perHost?: boolean; onProgress?: ProgressFn } = {},
): Promise<StreamSource[]> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const perHost = opts.perHost !== false;

  const resolvedByKey = new Map<string, string | null>();
  const resolvedByUrl = new Map<string, string | null>();
  const out: StreamSource[] = [];

  for (const s of sources) {
    // Même URL exacte (clic défaut + clic version) : même résultat garanti,
    // inutile de relancer une résolution réseau complète.
    if (resolvedByUrl.has(s.url)) {
      out.push({ ...s, streamDirect: resolvedByUrl.get(s.url) ?? null });
      continue;
    }
    if (perHost) {
      const key = dedupKey(s.host, s.label, s.url);
      if (resolvedByKey.has(key)) {
        out.push({ ...s, streamDirect: resolvedByKey.get(key) ?? null });
        continue;
      }
    }
    try {
      const resolved = await resolveOne(browser, s, timeoutMs, opts.verbose, opts.onProgress);
      resolvedByUrl.set(s.url, resolved.streamDirect);
      if (perHost) {
        resolvedByKey.set(dedupKey(resolved.host, resolved.label, resolved.url), resolved.streamDirect);
      }
      out.push(resolved);
    } catch {
      resolvedByUrl.set(s.url, null);
      if (perHost) {
        resolvedByKey.set(dedupKey(s.host, s.label, s.url), null);
      }
      out.push({ ...s, streamDirect: null });
    }
  }

  opts.onProgress?.({ type: "resolve:all:done" });
  return out;
}
