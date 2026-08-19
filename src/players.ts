import type { Page } from "playwright";
import type { ProgressFn, StreamSource } from "./schema.js";

function log(verbose: boolean | undefined, msg: string): void {
  if (verbose) console.error(`[players] ${msg}`);
}

// Iframes à ignorer : YouTube (bande-annonce) et la passerelle SSO cachée
// du site (fsurl.lol/sso.php — beacon de session, pas un player).
const EXCLUDED_IFRAME_RE =
  /youtube\.com|youtu\.be|youtube-nocookie|\/sso\.php|^https?:\/\/fsurl\.lol\//i;

async function captureIframeUrls(
  page: Page,
  timeoutMs: number,
): Promise<{ src: string; title: string | null }[]> {
  const deadline = Date.now() + timeoutMs;
  const results: { src: string; title: string | null }[] = [];
  const seen = new Set<string>();

  while (Date.now() < deadline) {
    const frames = await page
      .evaluate(() => {
        const out: { src: string; title: string | null }[] = [];
        document
          .querySelectorAll('#cn-content iframe, #main-player iframe, .movie-players iframe, .player iframe')
          .forEach((el) => {
            const iframe = el as HTMLIFrameElement;
            const src = iframe.src || iframe.getAttribute("data-src") || "";
            if (!src) return;
            if (/youtube\.com|youtu\.be|youtube-nocookie/i.test(src)) return;
            if (src.startsWith("about:blank") || src === "") return;
            out.push({ src, title: iframe.getAttribute("title") || iframe.getAttribute("aria-label") });
          });
        return out;
      })
      .catch(() => [] as { src: string; title: string | null }[]);

    for (const f of frames) {
      if (!seen.has(f.src)) {
        seen.add(f.src);
        results.push(f);
      }
    }
    if (results.length > 0 && Date.now() > deadline - timeoutMs + 4000) {
      await page.waitForTimeout(800).catch(() => undefined);
      const again = await page
        .evaluate(() => {
          const out: string[] = [];
          document
            .querySelectorAll('#cn-content iframe, #main-player iframe, .movie-players iframe')
            .forEach((el) => {
              const iframe = el as HTMLIFrameElement;
              const src = iframe.src;
              if (src && !/youtube/i.test(src)) out.push(src);
            });
          return out;
        })
        .catch(() => [] as string[]);
      for (const s of again) {
        if (!seen.has(s)) seen.add(s);
      }
      break;
    }
    await page.waitForTimeout(400).catch(() => undefined);
  }
  return results;
}

/**
 * Attends que les boutons .player-option soient (re)présents et visibles.
 * Sert de récupération après une navigation inattendue (interstitiel anti-bot,
 * reload du site) qui détruit le contexte d'exécution des handles précédents.
 */
async function waitForPlayerButtons(page: Page, timeoutMs: number): Promise<boolean> {
  try {
    await page.waitForSelector(".player-option", { state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function readPlayerNames(page: Page): Promise<string[]> {
  return await page
    .locator(".player-option")
    .evaluateAll((btns) =>
      btns
        .map((b) => (b as HTMLElement).getAttribute("data-player")?.trim() ?? "")
        .filter((n): n is string => n.length > 0),
    )
    .catch(() => [] as string[]);
}

/**
 * Échappe une valeur pour un sélecteur d'attribut entre guillemets.
 */
function attrSelector(name: string, value: string): string {
  return `${name}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function clickPlayerAndCapture(
  page: Page,
  playerName: string,
  label: string,
  sources: StreamSource[],
  seenUrls: Set<string>,
  verbose: boolean | undefined,
  onProgress?: ProgressFn,
): Promise<void> {
  const recordIframe = (src: string, title: string | null) => {
    if (seenUrls.has(src)) return;
    if (EXCLUDED_IFRAME_RE.test(src)) return;
    seenUrls.add(src);
    let host: string | null = null;
    try {
      host = new URL(src).hostname.replace(/^www\./, "");
    } catch {
      host = null;
    }
    sources.push({ host, url: src, streamDirect: null, label: title });
    onProgress?.({ type: "iframe:found", url: src, host, label: title });
  };

  // Locator frais à chaque clic : les ElementHandle deviennent invalides dès
  // que la page navigue (interstitiel anti-bot du site), ce qui écrasait
  // auparavant toute la collecte avec « Execution context was destroyed ».
  const btn = page.locator(`.player-option[${attrSelector("data-player", playerName)}]`).first();
  await btn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
  await btn.click({ timeout: 6000, force: true }).catch((e: unknown) => {
    log(verbose, `Clic échoué sur ${playerName}: ${(e as Error).message.split("\n")[0]}`);
  });
  await page.waitForTimeout(1800).catch(() => undefined);

  const captured = await captureIframeUrls(page, 4000);
  for (const c of captured) {
    recordIframe(c.src, c.title);
    log(verbose, `→ iframe (${label}): ${c.src}`);
  }
}

export async function collectPlayers(
  page: Page,
  opts: { timeoutMs?: number; verbose?: boolean; onProgress?: ProgressFn } = {},
): Promise<StreamSource[]> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const verbose = opts.verbose;
  const onProgress = opts.onProgress;
  const sources: StreamSource[] = [];
  const seenUrls = new Set<string>();

  // Noms des players lus dans le DOM courant ; si la page vient tout juste de
  // se charger, on laisse un court délai au JS du site pour les injecter.
  let playerNames = await readPlayerNames(page);
  if (playerNames.length === 0) {
    if (await waitForPlayerButtons(page, Math.min(timeoutMs, 10_000))) {
      playerNames = await readPlayerNames(page);
    }
  }
  log(verbose, `${playerNames.length} boutons player-option trouvés`);
  onProgress?.({ type: "players:start", count: playerNames.length });

  if (playerNames.length === 0) {
    const captured = await captureIframeUrls(page, 5000);
    for (const c of captured) {
      if (EXCLUDED_IFRAME_RE.test(c.src)) continue;
      if (seenUrls.has(c.src)) continue;
      seenUrls.add(c.src);
      let host: string | null = null;
      try {
        host = new URL(c.src).hostname.replace(/^www\./, "");
      } catch {
        host = null;
      }
      sources.push({ host, url: c.src, streamDirect: null, label: c.title });
      onProgress?.({ type: "iframe:found", url: c.src, host, label: c.title });
    }
    return sources;
  }

  for (let i = 0; i < playerNames.length; i++) {
    const playerName = playerNames[i];
    log(verbose, `Clic player: ${playerName}`);
    onProgress?.({ type: "players:click", player: playerName });

    try {
      await clickPlayerAndCapture(
        page,
        playerName,
        `${playerName} (défaut)`,
        sources,
        seenUrls,
        verbose,
        onProgress,
      );

      // Versions linguistiques (dropdown imbriqué dans le bouton du player).
      const versions: string[] = await page
        .locator(`.player-option[${attrSelector("data-player", playerName)}] .version-option`)
        .evaluateAll((els) =>
          els
            .map((e) => (e as HTMLElement).getAttribute("data-version")?.trim() ?? "")
            .filter((v): v is string => v.length > 0),
        )
        .catch(() => [] as string[]);

      for (const version of versions) {
        try {
          const vBtn = page
            .locator(
              `.player-option[${attrSelector("data-player", playerName)}] ` +
                `.version-option[${attrSelector("data-version", version)}]`,
            )
            .first();
          await vBtn.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
          await vBtn.click({ timeout: 6000, force: true }).catch(() => undefined);
          await page.waitForTimeout(1800).catch(() => undefined);
          const vIframes = await captureIframeUrls(page, 4000);
          for (const c of vIframes) {
            if (seenUrls.has(c.src) || EXCLUDED_IFRAME_RE.test(c.src)) continue;
            seenUrls.add(c.src);
            let host: string | null = null;
            try {
              host = new URL(c.src).hostname.replace(/^www\./, "");
            } catch {
              host = null;
            }
            sources.push({ host, url: c.src, streamDirect: null, label: `${playerName} ${version}`.trim() });
            onProgress?.({ type: "iframe:found", url: c.src, host, label: `${playerName} ${version}` });
            log(verbose, `→ iframe (${playerName} ${version}): ${c.src}`);
          }
        } catch (e: unknown) {
          log(verbose, `Version ${version} de ${playerName} échouée: ${(e as Error).message.split("\n")[0]}`);
        }
      }
    } catch (e: unknown) {
      // Navigation inattendue (interstitiel anti-bot, reload) : les handles et
      // le contexte meurent. On attend que la page se stabilise et que les
      // boutons reviennent avant de continuer avec les players restants,
      // plutôt que de jeter toute la collecte.
      log(verbose, `Player ${playerName} interrompu: ${(e as Error).message.split("\n")[0]}`);
      const recovered = await waitForPlayerButtons(page, 15_000);
      if (!recovered) {
        log(verbose, "Boutons players irretrouvables après navigation, arrêt de la collecte");
        break;
      }
      await page.waitForTimeout(1000).catch(() => undefined);
      // Les boutons peuvent avoir changé après le reload : on relit la liste
      // et on repart à l'indice courant si les players suivants existent encore.
      const freshNames = await readPlayerNames(page);
      if (freshNames.length > 0) playerNames.splice(0, playerNames.length, ...freshNames);
    }
  }

  for (const s of sources) {
    try {
      s.host = new URL(s.url).hostname.replace(/^www\./, "");
    } catch {
      s.host = null;
    }
  }
  onProgress?.({ type: "players:done", total: sources.length });
  return sources;
}
