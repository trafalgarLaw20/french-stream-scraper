/**
 * Diagnostic lecture vidéo : ouvre l'app, joue un flux via le bouton Lire,
 * puis inspecte l'état de décodage (videoWidth, temps, erreurs console).
 */
import { chromium } from "playwright";

const MOVIE_ID = process.argv[2] ?? "3"; // Mortal Kombat II (liens uqload valides)

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });

const consoleMsgs: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") consoleMsgs.push(`[${m.type()}] ${m.text().slice(0, 150)}`);
});

await page.goto("http://127.0.0.1:3000/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

// Ouvrir le modal du film directement via l'API + DOM (catalogue → carte)
await page.getByRole("button", { name: "Catalogue" }).click();
await page.waitForTimeout(1800);

// Chercher le film pour n'avoir que sa carte
const search = page.getByRole("searchbox");
await search.click();
await search.fill("Mortal");
await page.waitForTimeout(1500);

const card = page.locator("main button", { hasText: "Mortal" }).first();
await card.click();
await page.waitForTimeout(2500);

// Cliquer le premier bouton Lire (n'importe quelle source valide)
const lireBtn = page.getByRole("button", { name: "Lire" }).first();
if ((await lireBtn.count()) === 0) throw new Error("Aucun bouton Lire visible");
await lireBtn.click();
console.error("[diag] Lire cliqué, attente de la lecture…");
await page.waitForTimeout(10_000);

const state = await page.evaluate(() => {
  const v = document.querySelector("video");
  if (!v) return { video: false };
  return {
    video: true,
    videoWidth: v.videoWidth,
    videoHeight: v.videoHeight,
    currentTime: Number(v.currentTime.toFixed(1)),
    paused: v.paused,
    readyState: v.readyState,
    clientSize: `${v.clientWidth}x${v.clientHeight}`,
    src: v.currentSrc || v.src.slice(0, 80),
  };
});
console.error(`[diag] état vidéo: ${JSON.stringify(state, null, 2)}`);
console.error(`[diag] console: ${consoleMsgs.length ? consoleMsgs.slice(0, 5).join(" | ") : "rien"}`);

// Screenshot de la zone lecteur
const playerBox = await page.locator("video").boundingBox();
if (playerBox) {
  await page.screenshot({
    path: "/tmp/player-test.png",
    clip: {
      x: Math.max(0, playerBox.x - 20),
      y: Math.max(0, playerBox.y - 60),
      width: Math.min(playerBox.width + 40, 1400),
      height: playerBox.height + 120,
    },
  });
  console.error("[diag] capture: /tmp/player-test.png");
}
await browser.close();
