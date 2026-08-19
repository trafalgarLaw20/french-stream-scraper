import { launchFetcher, fetchPage, closeFetcher } from "../src/fetcher.js";

const url = process.argv[2] ?? "https://french-stream.one/";
const { browser } = await launchFetcher({ verbose: true });
try {
  const f = await fetchPage(url, browser, { verbose: true, timeoutMs: 90_000 });
  await import("node:fs/promises").then((fs) =>
    fs.writeFile("debug-page.html", f.html, "utf8"),
  );
  console.error("HTML sauvegardé dans debug-page.html (taille:", f.html.length, "octets)");
  console.error("URL finale:", f.url);
} finally {
  await closeFetcher(browser);
}
