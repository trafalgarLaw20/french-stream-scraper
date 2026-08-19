import { spawn } from "node:child_process";
import type { ProgressFn } from "../schema.js";

const VERSION_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;

let availabilityCache: boolean | null = null;

export async function isYtDlpAvailable(): Promise<boolean> {
  if (availabilityCache !== null) return availabilityCache;
  return await new Promise<boolean>((resolve) => {
    const child = spawn("yt-dlp", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      availabilityCache = ok;
      resolve(ok);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(false);
    }, VERSION_TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(timer);
      finish(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0);
    });
  });
}

interface YtFormat {
  url?: string;
  ext?: string;
  protocol?: string;
  manifest_url?: string;
  vcodec?: string;
  acodec?: string;
}

interface YtInfo {
  url?: string;
  ext?: string;
  protocol?: string;
  formats?: YtFormat[];
  entries?: YtInfo[];
}

const STREAM_RE = /\.(m3u8|mp4|webm|mkv|mpd)(\?|$)/i;
// Domaines servant des vidéos de test/placeholder : certains proxies d'hébergeurs
// (kakaflix doo02…) livrent Big Buck Bunny quand la vraie vidéo est bloquée ;
// yt-dlp l'extrait comme un mp4 légitime, mais ce n'est pas le film demandé.
const JUNK_URL_RE = /test-videos\.co\.uk|bigbuckbunny|example\.com\//i;

function pickBestUrl(info: YtInfo): string | null {
  if (info.entries?.length) return pickBestUrl(info.entries[0]);
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const isStream = (u?: string) => !!u && STREAM_RE.test(u) && !JUNK_URL_RE.test(u);

  const m3u8 = formats.find(
    (f) =>
      /m3u8/i.test(f.url ?? "") ||
      /m3u8/i.test(f.protocol ?? "") ||
      f.ext === "m3u8" ||
      /m3u8/i.test(f.manifest_url ?? ""),
  );
  if (m3u8?.url && !JUNK_URL_RE.test(m3u8.url)) return m3u8.url;
  if (info.url && /\.m3u8(\?|$)/i.test(info.url) && !JUNK_URL_RE.test(info.url)) return info.url;

  const mp4 = formats.find((f) => (f.ext === "mp4" || /mp4/i.test(f.url ?? "")) && !JUNK_URL_RE.test(f.url ?? ""));
  if (mp4?.url) return mp4.url;
  if (info.url && isStream(info.url)) return info.url;

  const anyStream = formats.find((f) => isStream(f.url));
  // Ne jamais retomber sur info.url tel quel : pour certaines pages embed,
  // yt-dlp (extracteur générique via og:video…) y met l'URL de la page elle-même,
  // ce qui produisait un streamDirect faux positif égal à l'iframe.
  return anyStream?.url ?? null;
}

function safeParse(stdout: string): YtInfo | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as YtInfo;
  } catch {
    /* multi-lignes ? on tente la première ligne */
  }
  const nl = trimmed.indexOf("\n");
  const firstLine = nl >= 0 ? trimmed.slice(0, nl) : trimmed;
  try {
    return JSON.parse(firstLine) as YtInfo;
  } catch {
    return null;
  }
}

export async function resolveWithYtDlp(
  url: string,
  opts: { timeoutMs?: number; verbose?: boolean; onProgress?: ProgressFn } = {},
): Promise<string | null> {
  const verbose = opts.verbose;
  if (!(await isYtDlpAvailable())) {
    log(
      verbose,
      "binaire yt-dlp indisponible — installez-le : `brew install yt-dlp` ou `pip install yt-dlp`",
    );
    return null;
  }

  const timeoutMs = Math.min(opts.timeoutMs ?? MAX_TIMEOUT_MS, MAX_TIMEOUT_MS);
  log(verbose, `yt-dlp résolution: ${url}`);

  return await new Promise<string | null>((resolve) => {
    const args = [
      "-J",
      "--no-warnings",
      "--no-playlist",
      "--no-progress",
      "--ignore-config",
      "--socket-timeout",
      "20",
      url,
    ];
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    let settled = false;
    const done = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      log(verbose, `yt-dlp timeout (${timeoutMs}ms) pour ${url}`);
      done(null);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (e) => {
      log(verbose, `yt-dlp spawn error: ${e.message}`);
      availabilityCache = false;
      done(null);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const tail = stderr.trim().split("\n").slice(-3).join(" ");
        log(verbose, `yt-dlp exit ${code} pour ${url}: ${tail}`);
        done(null);
        return;
      }
      const info = safeParse(stdout);
      if (!info) {
        log(verbose, `yt-dlp JSON illisible pour ${url}`);
        done(null);
        return;
      }
      const best = pickBestUrl(info);
      if (best) {
        log(verbose, `yt-dlp flux trouvé: ${best}`);
        opts.onProgress?.({ type: "resolve:candidate", url: best });
      } else {
        log(verbose, `yt-dlp aucun flux extrait pour ${url}`);
      }
      done(best ?? null);
    });
  });
}

function log(verbose: boolean | undefined, msg: string): void {
  if (verbose) console.error(`[ytdlp] ${msg}`);
}
