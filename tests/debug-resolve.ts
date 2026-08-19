/**
 * Test rapide de resolveIframeToStream sur des URLs d'embed données.
 * Usage: npx tsx tests/debug-resolve.ts <url1> [url2] ...
 */
import { launchFetcher, closeFetcher } from "../src/fetcher.js";
import { resolveIframeToStream } from "../src/extractors/index.js";

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error("Usage: npx tsx tests/debug-resolve.ts <url1> [url2] ...");
  process.exit(1);
}

const { browser } = await launchFetcher({ verbose: true });
try {
  for (const url of urls) {
    const t0 = Date.now();
    const direct = await resolveIframeToStream(browser, url, { verbose: true, timeoutMs: 40_000 });
    console.error(`\n=== ${url}\n→ ${(direct ?? "NULL").slice(0, 120)} (${Date.now() - t0}ms)\n`);
  }
} finally {
  await closeFetcher(browser);
}
