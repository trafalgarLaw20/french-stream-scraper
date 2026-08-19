import type { Browser, Request, Response } from "playwright";
import type { ProgressFn } from "../schema.js";
import { applyStealth } from "../fetcher.js";

const STREAM_EXT = /\.(m3u8|mp4|webm|mkv|m4s|mpd)(\?|$)/i;
const STREAM_MIME =
  /(video\/|application\/vnd\.apple\.mpegurl|application\/x-mpegURL|application\/dash\+xml)/i;

function log(verbose: boolean | undefined, msg: string): void {
  if (verbose) console.error(`[resolver] ${msg}`);
}

export async function resolveViaNetwork(
  browser: Browser,
  url: string,
  opts: { timeoutMs?: number; verbose?: boolean; onProgress?: ProgressFn } = {},
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const verbose = opts.verbose;
  const onProgress = opts.onProgress;

  log(verbose, `Résolution réseau iframe: ${url}`);
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  });
  await applyStealth(context);
  const page = await context.newPage();

  const candidates: string[] = [];
  const urlSet = new Set<string>();

  const onRequest = (req: Request) => {
    const u = req.url();
    if (!u || urlSet.has(u)) return;
    const type = req.resourceType();
    let contentType = "";
    try {
      const h = req.headers();
      contentType = h["content-type"] ?? "";
    } catch {
      /* ignore */
    }
    if (
      type === "media" ||
      type === "manifest" ||
      STREAM_EXT.test(u) ||
      STREAM_MIME.test(contentType)
    ) {
      urlSet.add(u);
      candidates.push(u);
      log(verbose, `→ candidat flux: ${u}`);
    }
  };

  const onResponse = (res: Response) => {
    const u = res.url();
    if (!u || urlSet.has(u)) return;
    const type = res.request().resourceType();
    let contentType = "";
    try {
      contentType = res.headers()["content-type"] ?? "";
    } catch {
      /* ignore */
    }
    if (
      type === "media" ||
      type === "manifest" ||
      STREAM_MIME.test(contentType) ||
      STREAM_EXT.test(u)
    ) {
      urlSet.add(u);
      candidates.push(u);
      log(verbose, `→ candidat flux (resp): ${u}`);
      onProgress?.({ type: "resolve:candidate", url: u });
    }
  };

  page.on("request", onRequest);
  page.on("response", onResponse);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page
      .waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 15_000) })
      .catch(() => {});

    const inline = await page
      .evaluate(() => {
        const html = document.documentElement.outerHTML;
        const out: string[] = [];
        const re = /https?:\/\/[^\s"'<>()]+?\.(?:m3u8|mp4|webm|mkv|mpd)(?:\?[^\s"'<>()]*)?/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) !== null) out.push(m[0]);
        const sources = Array.from(
          document.querySelectorAll("video source, source[src], video[src]"),
        ) as HTMLSourceElement[] | HTMLVideoElement[];
        for (const s of sources) {
          const v = (s as HTMLSourceElement).src || s.getAttribute("src");
          if (v) out.push(v);
        }
        return out;
      })
      .catch(() => [] as string[]);

    for (const u of inline) {
      if (!urlSet.has(u)) {
        urlSet.add(u);
        candidates.push(u);
      }
    }
  } catch (e) {
    log(verbose, `Erreur résolution réseau ${url}: ${(e as Error).message}`);
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
    await context.close().catch(() => undefined);
  }

  const preferred =
    candidates.find((u) => /\.m3u8(\?|$)/i.test(u)) ?? candidates[0] ?? null;
  log(verbose, preferred ? `Flux réseau retenu: ${preferred}` : `Aucun flux réseau pour ${url}`);
  return preferred;
}
