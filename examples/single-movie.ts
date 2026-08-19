import { scrapeMovie } from "../src/index.js";

async function main(): Promise<void> {
  const url = process.argv[2] ?? "https://french-stream.one/film/exemple";
  console.error("Exemple de scrape sur:", url);
  const info = await scrapeMovie(url, { resolveStreams: true, verbose: true });
  console.log(JSON.stringify(info, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
