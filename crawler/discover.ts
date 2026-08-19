import type { Browser } from "playwright";
import * as cheerio from "cheerio";
import { launchFetcher, fetchPage, closeFetcher } from "../src/fetcher.js";
import { db } from "../pg/client";
import { urlQueue } from "../pg/schema/index";

const SITE_ORIGIN = "https://french-stream.one";
const CATEGORIES = ["films", "series"] as const;
export type Category = (typeof CATEGORIES)[number];

export type DiscoverKind = "movie" | "series";

export interface DiscoverOptions {
  categories?: Category[];
  /** Limite le nombre de pages par catégorie (tests). Default: illimité. */
  maxPages?: number;
  verbose?: boolean;
  onPageDone?: (e: {
    category: Category;
    page: number;
    found: number;
    totalSoFar: number;
  }) => void;
}

export interface DiscoverResult {
  totalFound: number;
  byCategory: Record<Category, { pages: number; found: number; totalPages: number }>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function log(verbose: boolean | undefined, msg: string): void {
  if (verbose) console.error(`[discover] ${msg}`);
}

function categoryToKind(cat: Category): DiscoverKind {
  return cat === "series" ? "series" : "movie";
}

function pageUrl(cat: Category, page: number): string {
  if (page === 1) return `${SITE_ORIGIN}/${cat}/`;
  return `${SITE_ORIGIN}/index.php?cstart=${page}&do=cat&category=${cat}`;
}

function extractTotalPages(html: string): number {
  const $ = cheerio.load(html);
  let max = 1;
  $('nav.bottom-nav .navigation a[href*="cstart="]').each((_, el) => {
    const m = $(el).attr("href")?.match(/cstart=(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max;
}

interface FicheLink {
  url: string;
  titre: string | null;
}

function extractFicheUrls(html: string): FicheLink[] {
  const $ = cheerio.load(html);
  const urls: FicheLink[] = [];
  const seen = new Set<string>();
  $('a.short-poster.img-box[href*="newsid="]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href") ?? "";
    if (!href) return;
    const abs = href.startsWith("/") ? SITE_ORIGIN + href : href;
    if (seen.has(abs)) return;
    seen.add(abs);
    const titre = $a.attr("alt")?.trim() || null;
    urls.push({ url: abs, titre });
  });
  return urls;
}

async function upsertUrls(items: FicheLink[], kind: DiscoverKind): Promise<number> {
  if (items.length === 0) return 0;
  const inserted = await db
    .insert(urlQueue)
    .values(items.map((i) => ({ url: i.url, kind })))
    .onConflictDoNothing()
    .returning();
  return inserted.length;
}

async function discoverCategory(
  browser: Browser,
  cat: Category,
  opts: DiscoverOptions,
): Promise<{ pages: number; found: number; totalPages: number }> {
  const kind = categoryToKind(cat);
  log(opts.verbose, `Démarrage catégorie ${cat}`);

  // Page 1 : on récupère le HTML + totalPages depuis le footer pagination
  const f1 = await fetchPage(pageUrl(cat, 1), browser, {
    verbose: opts.verbose,
    timeoutMs: 90_000,
  });
  const totalPages = extractTotalPages(f1.html);
  const limit = Math.min(opts.maxPages ?? totalPages, totalPages);
  log(opts.verbose, `${cat}: ${totalPages} pages au total, limite = ${limit}`);

  let total = 0;

  // Page 1
  const urls1 = extractFicheUrls(f1.html);
  const ins1 = await upsertUrls(urls1, kind);
  total += ins1;
  log(opts.verbose, `[${cat} p1] ${urls1.length} URLs extraites, ${ins1} nouvelles en DB`);
  opts.onPageDone?.({ category: cat, page: 1, found: ins1, totalSoFar: total });
  await f1.page.close();

  // Pages 2..limit
  for (let p = 2; p <= limit; p++) {
    try {
      const f = await fetchPage(pageUrl(cat, p), browser, {
        verbose: opts.verbose,
        timeoutMs: 90_000,
      });
      const urls = extractFicheUrls(f.html);
      const ins = await upsertUrls(urls, kind);
      total += ins;
      log(opts.verbose, `[${cat} p${p}/${limit}] ${urls.length} URLs, ${ins} nouvelles`);
      opts.onPageDone?.({ category: cat, page: p, found: ins, totalSoFar: total });
      await f.page.close();

      // Délai anti-ban aléatoire entre 2,5 s et 4 s
      await sleep(2500 + Math.random() * 1500);
    } catch (e) {
      log(opts.verbose, `[${cat} p${p}] ERREUR: ${(e as Error).message}`);
      await sleep(10_000); // repos plus long en cas d'erreur
    }
  }

  return { pages: limit, found: total, totalPages };
}

export async function discoverAll(opts: DiscoverOptions = {}): Promise<DiscoverResult> {
  const categories = opts.categories ?? [...CATEGORIES];
  const { browser } = await launchFetcher({ verbose: opts.verbose });
  try {
    const byCategory = {} as DiscoverResult["byCategory"];
    let totalFound = 0;
    for (const cat of categories) {
      const r = await discoverCategory(browser, cat, opts);
      byCategory[cat] = r;
      totalFound += r.found;
      // Pause entre catégories
      if (categories.indexOf(cat) < categories.length - 1) {
        await sleep(5000);
      }
    }
    return { totalFound, byCategory };
  } finally {
    await closeFetcher(browser);
    // Note : le pool PG est volontairement laissé ouvert — c'est l'appelant
    // (script CLI ou scheduler Fastify) qui décide de le fermer.
  }
}
