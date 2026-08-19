import * as cheerio from "cheerio";
import type { MovieInfo, StreamSource } from "./schema.js";
import {
  clean,
  hostFromUrl,
  parseYear,
  splitList,
  metaContent,
  extractFlist,
  extractIframes as sharedExtractIframes,
} from "../parser/shared.js";

export { extractIframes } from "../parser/shared.js";

export function parseMovie(html: string, url: string, extraIframes?: StreamSource[]): MovieInfo {
  const $ = cheerio.load(html);
  const { finfo, finfoMap } = extractFlist($);

  const yearFromReleaseRaw =
    finfoMap["date de sortie"] ??
    clean($(".release_date a, .release_date").first().text()) ??
    metaContent($, ["article:published_time", "og:updated_time"]) ??
    null;
  const yearFromRelease = yearFromReleaseRaw ? yearFromReleaseRaw.replace(/^[-–—\s]+/, "") : null;
  const annee =
    parseYear(yearFromRelease) ??
    parseYear($(".year, .annee, .date").first().text());
  const dateSortie = yearFromRelease;

  const h1El = $("#s-title, h1").first();
  h1El.find(".release_date, .tag").remove();
  const h1 = clean(h1El.text());
  const titre = metaContent($, ["og:title"]) ?? h1;

  const titreOriginal = finfoMap["titre original"] ?? null;

  const description =
    clean($(".fdesc").clone().find(".desc-text").remove().end().text()) ||
    clean($(".fdesc .desc-text").nextAll().text()) ||
    clean($(".fdesc").text()) ||
    metaContent($, ["og:description", "twitter:description", "description"]);

  const genres =
    finfo["genre"]?.length ?
      finfo["genre"]
    : splitList(
        $(".facts .genres a, .genres a, [itemprop=genre]")
          .map((_, e) => $(e).text())
          .get()
          .join(","),
      );

  const categories = splitList(
    $(".category, .categories a, .breadcrumb li, [itemprop=category]")
      .map((_, e) => $(e).text())
      .get()
      .join(","),
  );

  const acteursRaw = (finfo["acteurs"] ??
    $("#actorList .actor-info strong")
      .map((_, e) => clean($(e).text()))
      .get()
      .filter((x): x is string => Boolean(x)));
  const acteurs = [...new Set(acteursRaw)];

  const realisation = finfo["réalisateur"] ??
    finfo["realisateur"] ??
    splitList(
      $(".director a, [itemprop=director], .realisation a")
        .map((_, e) => $(e).text())
        .get()
        .join(","),
    );

  const pays =
    finfo["pays"] ??
    splitList(
      $(".country a, [itemprop=countryOfOrigin] a, .pays a")
        .map((_, e) => $(e).text())
        .get()
        .join(","),
    );

  const langue = finfo["langue d'origine"] ?? finfo["langue"] ?? [];

  const dureeRaw = clean($(".facts .runtime, .runtime, [itemprop=duration]").first().text());
  const duree = dureeRaw ? dureeRaw.replace(/^[-–—\s]+/, "").trim() || null : null;

  const noteStr =
    clean($(".vote-score, .imdb-score, [itemprop=ratingValue]").first().text()) ??
    metaContent($, ["og:rating"]);
  const noteMatch = noteStr?.match(/(\d+(?:[.,]\d+)?)/) ?? null;
  const note = noteMatch ? Number(noteMatch[1].replace(",", ".")) : null;

  const poster =
    clean($(".fposter img").attr("src")) ??
    clean($('img[alt*="affiche"]').attr("src")) ??
    metaContent($, ["og:image", "twitter:image"]);
  const backdrop =
    clean($(".fmain").attr("style")?.match(/url\(([^)]+)\)/)?.[1] ?? "") ??
    metaContent($, ["og:image:secure_url"]) ??
    null;

  const qualite = finfo["qualité"] ?? finfo["qualite"] ?? [];
  const version = finfo["version"] ?? [];

  const iframes = [...(extraIframes ?? []), ...sharedExtractIframes(html)];
  void hostFromUrl; // conservé pour compat callers externes

  return {
    url,
    titre,
    titreOriginal,
    description,
    annee,
    dateSortie,
    categories,
    genres,
    pays,
    realisation,
    acteurs,
    duree,
    note,
    qualite,
    version,
    langue,
    poster,
    backdrop,
    iframes,
    scrapedAt: new Date().toISOString(),
  };
}
