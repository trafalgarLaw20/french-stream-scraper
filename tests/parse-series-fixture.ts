import { readFile } from "node:fs/promises";
import { parseSeries, detectSeries } from "../parser/series.js";

const HTML_PATH = process.argv[2] ?? "debug-page.html";
const URL = process.argv[3] ?? "https://french-stream.one/index.php?newsid=15126588";

async function main(): Promise<void> {
  const html = await readFile(HTML_PATH, "utf8");
  console.log(`HTML: ${html.length} octets`);
  console.log(`detectSeries: ${detectSeries(html)}`);

  const info = parseSeries(html, URL);
  console.log("\n=== Métadonnées ===");
  console.log(`titre:        ${info.titre}`);
  console.log(`seasonNumber: ${info.seasonNumber}`);
  console.log(`annee:        ${info.annee}`);
  console.log(`genres:       ${info.genres.join(", ")}`);
  console.log(`acteurs:      ${info.acteurs.slice(0, 5).join(", ")}${info.acteurs.length > 5 ? "…" : ""}`);
  console.log(`poster:       ${info.poster}`);
  console.log(`status:       ${info.status ?? "—"}`);

  console.log(`\n=== Épisodes (${info.episodes.length}) ===`);
  for (const ep of info.episodes) {
    console.log(`  [${ep.version}] ${ep.number}. ${ep.title}`);
  }

  console.log(`\n=== Autres saisons (${info.otherSeasons.length}) ===`);
  for (const s of info.otherSeasons) {
    console.log(`  ${s.titre} (n°${s.number ?? "?"}) → ${s.url}`);
  }

  console.log(`\n=== Iframes (${info.iframes.length}) ===`);
  for (const i of info.iframes.slice(0, 5)) {
    console.log(`  [${i.host}] ${i.url}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
