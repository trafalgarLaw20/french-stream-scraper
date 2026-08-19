#!/usr/bin/env node
import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { scrapeMovie } from "./index.js";

const program = new Command();

program
  .name("fss")
  .description("Scraper pour sites de streaming (french-stream.one)")
  .argument("<url>", "URL de la page du film")
  .option("-o, --out <path>", "Écrire le JSON dans un fichier au lieu de stdout")
  .option("--no-resolve", "Ne pas résoudre le flux direct (m3u8/mp4) des iframes")
  .option("--headed", "Lancer le navigateur en mode visible (debug)")
  .option("--cookies <file>", "Fichier JSON de cookies Playwright à charger")
  .option("-t, --timeout <ms>", "Timeout par page en ms", "90000")
  .option("-v, --verbose", "Logs de progression sur stderr")
  .version("0.1.0")
  .action(async (url: string, opts: {
    out?: string;
    resolve?: boolean;
    headed?: boolean;
    cookies?: string;
    timeout?: string;
    verbose?: boolean;
  }) => {
    const json = await scrapeMovie(url, {
      out: opts.out,
      headed: opts.headed,
      resolveStreams: opts.resolve !== false,
      cookieFile: opts.cookies,
      timeoutMs: Number(opts.timeout ?? "60000"),
      verbose: opts.verbose,
    });
    const text = JSON.stringify(json, null, 2);
    if (opts.out) {
      await writeFile(opts.out, text + "\n", "utf8");
      if (opts.verbose) console.error(`[fss] écrit dans ${opts.out}`);
    } else {
      process.stdout.write(text + "\n");
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(
    "Erreur: " +
      (err instanceof Error ? err.message : String(err)),
  );
  process.exit(1);
});
