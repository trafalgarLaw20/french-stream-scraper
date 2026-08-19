import * as cheerio from "cheerio";
import type { StreamSource } from "../src/schema.js";

export function clean(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length ? t : null;
}

export function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export function parseYear(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/\b(19\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

export function splitList(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(/[,;·•|/]|&amp;|\bet\b|-{2,}/i)
    .map((x) => clean(x))
    .filter((x): x is string => Boolean(x));
}

export function metaContent($: cheerio.CheerioAPI, names: string[]): string | null {
  for (const n of names) {
    const v =
      $(`meta[property="${n}"]`).attr("content") ||
      $(`meta[name="${n}"]`).attr("content") ||
      $(`meta[itemprop="${n}"]`).attr("content");
    const c = clean(v);
    if (c) return c;
  }
  return null;
}

export function extractFlist($: cheerio.CheerioAPI): {
  finfo: Record<string, string[]>;
  finfoMap: Record<string, string>;
} {
  const finfo: Record<string, string[]> = {};
  const finfoMap: Record<string, string> = {};
  $(".flist-col li, #s-list li, .flist li, .finfo li, .facts-list li, .movie-info li").each((_, li) => {
    const $li = $(li);
    const label = clean($li.find("span").first().text())?.replace(/:$/, "").toLowerCase();
    if (!label) return;
    $li.find("span").first().remove();
    const links = $li
      .find("a")
      .map((_, a) => clean($(a).text()))
      .get()
      .filter((x): x is string => Boolean(x));
    const textVal = clean($li.text());
    finfo[label] = links.length ? links : textVal ? [textVal] : [];
    if (finfo[label].length) finfoMap[label] = finfo[label][0];
  });
  return { finfo, finfoMap };
}

// Iframes et attributs à ignorer : YouTube (bande-annonce), et la passerelle
// SSO cachée du site (fsurl.lol/sso.php — beacon de session hors écran, pas
// un player : sa résolution échoue toujours et pollue les résultats).
const EXCLUDED_URL_RE = /youtube\.com|youtu\.be|youtube-nocookie|fsurl\.lol\/sso\.php/i;
// Iframe volontairement masqué hors écran (left/top: -9999px…)
const OFFSCREEN_STYLE_RE = /(?:left|top|right|bottom)\s*:\s*-\d{3,}/i;

export function extractIframes(html: string): StreamSource[] {
  const $ = cheerio.load(html);
  const found: StreamSource[] = [];
  const seen = new Set<string>();

  const add = (url: string, label: string | null, hostOverride?: string | null) => {
    if (seen.has(url)) return;
    seen.add(url);
    found.push({
      host: hostOverride ?? hostFromUrl(url),
      url,
      streamDirect: null,
      label: label || null,
    });
  };

  $('iframe[src], iframe[data-src]').each((_, el) => {
    const raw = clean($(el).attr("src")) ?? clean($(el).attr("data-src"));
    if (!raw) return;
    let abs = raw;
    if (raw.startsWith("//")) abs = "https:" + raw;
    else if (raw.startsWith("/")) abs = "https://french-stream.one" + raw;
    if (!/^https?:\/\//.test(abs)) return;
    if (EXCLUDED_URL_RE.test(abs)) return;
    if (OFFSCREEN_STYLE_RE.test($(el).attr("style") ?? "")) return;
    const label = clean($(el).attr("title")) ?? clean($(el).attr("aria-label"));
    add(abs, label);
  });

  for (const attr of ["data-url", "data-link", "data-src", "data-iframe", "data-video"]) {
    $(`[${attr}]`).each((_, el) => {
      const v = clean($(el).attr(attr));
      if (!v) return;
      const url = /^https?:\/\//.test(v) ? v : /^\/\//.test(v) ? "https:" + v : null;
      if (!url) return;
      if (EXCLUDED_URL_RE.test(url)) return;
      const label = clean($(el).text());
      add(url, label);
    });
  }

  return found;
}
