/**
 * CLI : discovery du catalogue.
 *
 * Usage :
 *   npx tsx scripts/discover.ts [--categories films,series] [--max-pages N] [--verbose]
 *
 * Exemples :
 *   npm run discover -- --max-pages 2 --verbose     # test rapide
 *   npm run discover -- --categories films          # que les films
 *   npm run discover                                 # tout (défaut)
 */
import "dotenv/config";
import { discoverAll, type Category } from "../crawler/discover";
import { pgPool } from "../pg/client";

const args = process.argv.slice(2);

function argValue(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

const categoriesArg = argValue("categories");
const categories = (
  categoriesArg ? (categoriesArg.split(",") as Category[]) : (["films", "series"] as Category[])
).filter((c): c is Category => c === "films" || c === "series");

const maxPagesArg = argValue("max-pages");
const maxPages = maxPagesArg ? Number(maxPagesArg) : undefined;
if (maxPages !== undefined && (!Number.isFinite(maxPages) || maxPages < 1)) {
  console.error("--max-pages doit être un entier positif");
  process.exit(2);
}

const verbose = args.includes("--verbose") || args.includes("-v");

console.error(
  `Discovery : categories=[${categories.join(", ")}] maxPages=${maxPages ?? "∞"} verbose=${verbose}`,
);

const startedAt = Date.now();
const result = await discoverAll({ categories, maxPages, verbose });
const durationS = Math.round((Date.now() - startedAt) / 1000);

console.log("\n=== RÉSULTATS ===");
console.log(JSON.stringify(result, null, 2));
console.log(`\nDurée totale : ${durationS}s`);
await pgPool.end();
