import type { Browser } from "playwright";
import type { ProgressFn } from "../schema.js";
import { resolveViaNetwork } from "./network.js";
import { resolveWithYtDlp } from "./ytdlp.js";

function log(verbose: boolean | undefined, msg: string): void {
  if (verbose) console.error(`[resolver] ${msg}`);
}

export async function resolveIframeToStream(
  browser: Browser,
  url: string,
  opts: { timeoutMs?: number; verbose?: boolean; onProgress?: ProgressFn } = {},
): Promise<string | null> {
  // 1) yt-dlp — couverture la plus large (Dood, Voe, Streamtape, Mixdrop, Filemoon…)
  const ytdlp = await resolveWithYtDlp(url, opts).catch((e: unknown) => {
    log(opts.verbose, `yt-dlp échoué pour ${url}: ${(e as Error).message}`);
    return null;
  });
  if (ytdlp) {
    log(opts.verbose, `Flux via yt-dlp: ${ytdlp}`);
    return ytdlp;
  }

  // 2) Interception réseau — repli pour les HLS custom non couverts par yt-dlp
  return await resolveViaNetwork(browser, url, opts).catch(() => null);
}
