import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import type { FetcherOptions } from "./schema.js";

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

/**
 * Evasions anti-bot exécutées avant chaque navigation, sur tous les frames.
 * Remplace puppeteer-extra-plugin-stealth : ses hooks `onPageCreated` asynchrones
 * (playwright-extra) survivaient à la fermeture du browser et levaient des
 * rejections non gérées (`Target page, context or browser has been closed`)
 * fatales pour le process sous Node 24.
 *
 * Ces patches couvrent les détections les plus courantes utilisées par
 * Cloudflare et l'interstitiel anti-bot du site.
 */
const STEALTH_INIT_SCRIPT = `(() => {
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => false,
      configurable: true,
    });
  } catch (e) {}
  try {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {},
        PlatformNaclArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {},
        connect: () => {}, sendMessage: () => {},
      };
    }
    if (!window.chrome.app) {
      window.chrome.app = {
        isInstalled: false, InstallState: {}, RunningState: {},
        getDetails: () => null, getIsInstalled: () => false,
      };
    }
    if (!window.chrome.csi) window.chrome.csi = () => ({ startE: Date.now(), onloadT: Date.now() });
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = () => ({
        commitLoadTime: Date.now() / 1000, connectionInformation: 'h2',
        finishDocumentLoadTime: Date.now() / 1000, finishLoadTime: Date.now() / 1000,
        firstPaintAfterLoadTime: 0, firstPaintTime: Date.now() / 1000,
        navigationType: 'Other', npnNegotiatedProtocol: 'h2', requestTime: Date.now() / 1000,
        startLoadTime: Date.now() / 1000, wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true, wasNpnNegotiated: true,
      });
    }
  } catch (e) {}
  try {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['fr-FR', 'fr', 'en-US', 'en'],
    });
  } catch (e) {}
  try {
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const make = (name) => {
          const p = Object.create(Plugin.prototype);
          Object.defineProperty(p, 'name', { value: name });
          Object.defineProperty(p, 'length', { value: 1 });
          return p;
        };
        const arr = [make('Chrome PDF Plugin'), make('Chrome PDF Viewer'), make('Native Client')];
        arr.item = (i) => arr[i] || null;
        arr.namedItem = (n) => arr.find((x) => x.name === n) || null;
        arr.refresh = () => {};
        return arr;
      },
    });
  } catch (e) {}
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (p) =>
        p && p.name === 'notifications'
          ? Promise.resolve({ state: (typeof Notification !== 'undefined' && Notification.permission) || 'default', onchange: null })
          : origQuery(p);
    }
  } catch (e) {}
  try {
    const patchWebGL = (proto) => {
      const getParameter = proto.getParameter;
      proto.getParameter = function (param) {
        // UNMASKED_VENDOR_WEBGL = 37445, UNMASKED_RENDERER_WEBGL = 37446
        if (param === 37445) return 'Intel Inc.';
        if (param === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter.call(this, param);
      };
    };
    if (window.WebGLRenderingContext) patchWebGL(WebGLRenderingContext.prototype);
    if (window.WebGL2RenderingContext) patchWebGL(WebGL2RenderingContext.prototype);
  } catch (e) {}
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
  } catch (e) {}
  try {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  } catch (e) {}
  try {
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
  } catch (e) {}
})();`;

/** Applique les evasions stealth à un context Playwright (à appeler avant newPage). */
export async function applyStealth(context: BrowserContext): Promise<void> {
  await context.addInitScript(STEALTH_INIT_SCRIPT);
}

export interface FetchedPage {
  html: string;
  url: string;
  page: Page;
  browser: Browser;
}

function log(verbose: boolean | undefined, msg: string): void {
  if (verbose) console.error(`[fetcher] ${msg}`);
}

function emit(opts: FetcherOptions, event: import("./schema.js").ScrapeEvent): void {
  opts.onProgress?.(event);
}

async function humanize(page: Page): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1366, height: 768 };
  for (let i = 0; i < 3; i++) {
    await page.mouse
      .move(Math.floor(Math.random() * viewport.width), Math.floor(Math.random() * viewport.height), {
        steps: 8 + Math.floor(Math.random() * 10),
      })
      .catch(() => undefined);
    await page.waitForTimeout(200 + Math.floor(Math.random() * 400)).catch(() => undefined);
  }
}

async function waitCloudflare(page: Page, timeoutMs: number, opts: FetcherOptions = {}): Promise<void> {
  const verbose = opts.verbose;
  const cfSelectors = [
    "#challenge-running",
    "#challenge-stage",
    ".cf-turnstile",
    'iframe[src*="challenges.cloudflare.com"]',
    "#cf-challenge-running",
    'div[id*="challenge"]',
  ];
  const start = Date.now();
  let stableSince: number | null = null;
  let lastUnInstantSeen = 0;
  let unInstantCount = 0;
  let humanizedForChallenge = false;

  while (Date.now() - start < timeoutMs) {
    const snapshot = await page
      .evaluate(() => ({
        title: document.title,
        body: (document.body?.innerText ?? "").slice(0, 800),
        reload: /location\.reload\s*\(/.test(document.documentElement.outerHTML),
        hasContent:
          (document.body?.innerText ?? "").trim().length > 600 &&
          document.querySelectorAll("a,article,.movie,.film,.post,iframe,#s-title,h1").length > 3,
      }))
      .catch(() => ({ title: "", body: "", reload: false, hasContent: false }));

    const txt = (snapshot.title + " " + snapshot.body).toLowerCase();
    const cfChallenge = /just a moment|checking your browser|attention required|cloudflare|verification|verifying you are human/i.test(
      txt,
    );
    const siteInterstitial = /un instant|reconnexion en cours|reprendre notre souffle|on reprend notre souffle/i.test(
      txt,
    );
    const hasTurnstile = await page
      .locator(cfSelectors.join(", "))
      .first()
      .isVisible({ timeout: 800 })
      .catch(() => false);

    if (cfChallenge || hasTurnstile) {
      log(verbose, `Challenge CF détecté: "${snapshot.title}"`);
      emit(opts, { type: "fetch:cf", title: snapshot.title });
      if (!humanizedForChallenge) {
        await humanize(page);
        humanizedForChallenge = true;
      }
      stableSince = null;
      await page.waitForTimeout(2500).catch(() => undefined);
      continue;
    }

    if (siteInterstitial) {
      unInstantCount++;
      log(verbose, `Interstitiel site (${unInstantCount}): "${snapshot.title}"`);
      stableSince = null;
      if (Date.now() - lastUnInstantSeen > 12_000) {
        lastUnInstantSeen = Date.now();
      }
      if (unInstantCount >= 6) {
        log(verbose, "Trop d'interstitiels, retry navigation");
        emit(opts, { type: "fetch:retry" });
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
        unInstantCount = 0;
        humanizedForChallenge = false;
        await humanize(page);
        continue;
      }
      await page.waitForTimeout(snapshot.reload ? 9000 : 3000).catch(() => undefined);
      continue;
    }

    if (snapshot.hasContent) {
      if (stableSince === null) stableSince = Date.now();
      if (Date.now() - stableSince > 1200) {
        log(verbose, "Contenu réel stable atteint");
        return;
      }
      await page.waitForTimeout(400).catch(() => undefined);
      continue;
    }

    log(verbose, "Page non chargée, attente...");
    await page.waitForTimeout(1000).catch(() => undefined);
  }
  log(verbose, "Timeout d'attente atteint, on continue avec le contenu courant");
}

export async function launchFetcher(opts: FetcherOptions = {}): Promise<{ browser: Browser }> {
  const browser = await chromium.launch({
    headless: !opts.headed,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });
  return { browser };
}

export async function fetchPage(
  url: string,
  browser: Browser,
  opts: FetcherOptions = {},
): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const context = await browser.newContext({
    userAgent: opts.userAgent ?? DEFAULT_UA,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    viewport: { width: 1366, height: 768 },
    extraHTTPHeaders: {
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    },
  });

  if (opts.cookieFile) {
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(opts.cookieFile, "utf8");
      const cookies = JSON.parse(raw);
      await context.addCookies(cookies);
      log(opts.verbose, `Cookies chargés depuis ${opts.cookieFile}`);
    } catch {
      log(opts.verbose, `Lecture cookies impossible: ${opts.cookieFile}`);
    }
  }

  await applyStealth(context);
  await context.setExtraHTTPHeaders({ "Accept-Language": "fr-FR,fr;q=0.9" });
  const page = await context.newPage();

  log(opts.verbose, `Navigation vers ${url}`);
  emit(opts, { type: "fetch:start", url });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

  await waitCloudflare(page, timeoutMs, opts);

  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 });
  } catch {
    /* ignore */
  }
  try {
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 15_000) });
  } catch {
    log(opts.verbose, "networkidle non atteint, on continue");
  }
  await page.waitForTimeout(1200).catch(() => undefined);

  let html = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      html = await page.content();
      break;
    } catch {
      log(opts.verbose, `page.content() en cours de navigation, retry ${attempt + 1}/5`);
      await page.waitForTimeout(800).catch(() => undefined);
    }
  }
  if (!html) {
    throw new Error("Impossible de récupérer le contenu de la page après plusieurs tentatives");
  }
  emit(opts, { type: "fetch:done", finalUrl: page.url() });
  return { html, url: page.url(), page, browser };
}

export async function closeFetcher(browser: Browser): Promise<void> {
  await browser.close().catch(() => undefined);
}
