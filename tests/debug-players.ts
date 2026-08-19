/**
 * Diagnostic : observer les navigations pendant les clics sur les players.
 * Charge une page film, clique chaque .player-option et trace :
 * navigations du frame principal, iframes visibles, erreurs de contexte.
 */
import { launchFetcher, fetchPage, closeFetcher } from "../src/fetcher.js";

const url = process.argv[2] ?? "https://french-stream.one/index.php?newsid=15127996";

const { browser } = await launchFetcher({ verbose: true });
try {
  const f = await fetchPage(url, browser, { verbose: true, timeoutMs: 90_000 });
  const page = f.page;

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      console.error(`[nav] ${new Date().toISOString().slice(11, 23)} → ${frame.url()}`);
    }
  });
  page.on("popup", (p) => console.error(`[popup] ${p.url()}`));

  const names = await page.locator(".player-option").evaluateAll((btns) =>
    btns.map((b) => (b as HTMLElement).getAttribute("data-player")),
  );
  console.error(`[diag] boutons: ${JSON.stringify(names)}`);

  for (let i = 0; i < names.length; i++) {
    console.error(`\n[diag] === clic ${i}: ${names[i]} ===`);
    try {
      // Requête fraîche à chaque itération (les handles meurent après navigation)
      const btn = page.locator(`.player-option[data-player="${names[i]}"]`).first();
      await btn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
      await btn.click({ timeout: 5000, force: true }).catch((e: Error) => console.error(`[diag] clic échoué: ${e.message.split("\n")[0]}`));
      await page.waitForTimeout(2500).catch(() => undefined);

      const iframes = await page
        .evaluate(() => {
          const out: string[] = [];
          document
            .querySelectorAll('#cn-content iframe, #main-player iframe, .movie-players iframe, .player iframe')
            .forEach((el) => {
              const src = (el as HTMLIFrameElement).src || el.getAttribute("data-src") || "";
              if (src && !/youtube/i.test(src)) out.push(src);
            });
          return out;
        })
        .catch((e: Error) => [`[evaluate échoué: ${e.message.split("\n")[0]}]`]);
      console.error(`[diag] iframes: ${JSON.stringify(iframes)}`);
      console.error(`[diag] url page: ${page.url()}`);
    } catch (e) {
      console.error(`[diag] erreur itération ${i}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
} finally {
  await closeFetcher(browser);
}
