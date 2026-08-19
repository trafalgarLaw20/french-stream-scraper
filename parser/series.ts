import * as cheerio from "cheerio";
import type { EpisodeInfo, MovieInfo, SeasonLink, SeriesInfo, StreamSource } from "../src/schema.js";
import {
  clean,
  hostFromUrl,
  parseYear,
  splitList,
  metaContent,
  extractFlist,
  extractIframes,
} from "./shared.js";

const SITE_ORIGIN = "https://french-stream.one";

/** Détecte si une page HTML est une fiche série (vs un film). */
export function detectSeries(html: string): boolean {
  const $ = cheerio.load(html);
  return (
    $(".episodes-list, .episode-row, #autres-saisons-posters, .seasons-container").length > 0
  );
}

function absUrl(href: string): string | null {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("/")) return SITE_ORIGIN + href;
  return null;
}

function extractSeasonNumberFromTitle(titre: string | null, url: string): number | null {
  if (titre) {
    const m = titre.match(/saison\s*(\d+)/i) ?? titre.match(/\bS(\d+)\b/);
    if (m) return Number(m[1]);
  }
  const slug = url.toLowerCase();
  const m2 = slug.match(/saison[-_]?(\d+)/) ?? slug.match(/\bs(\d+)\b/);
  return m2 ? Number(m2[1]) : null;
}

function extractEpisodes($: cheerio.CheerioAPI): EpisodeInfo[] {
  const episodes: EpisodeInfo[] = [];
  const seen = new Set<string>();

  $(".episode-row").each((_, el) => {
    const $el = $(el);
    const type = clean($el.attr("data-type")) ?? "vf";
    const numStr = clean($el.attr("data-num"));
    const num = numStr ? Number(numStr) : NaN;
    if (!Number.isFinite(num)) return;
    const title = clean($el.find(".ep-title span").first().text()) ?? `Episode ${num}`;
    const key = `${type}-${num}`;
    if (seen.has(key)) return;
    seen.add(key);
    episodes.push({ number: num, version: type, title });
  });

  return episodes.sort((a, b) => {
    if (a.version !== b.version) return a.version.localeCompare(b.version);
    return a.number - b.number;
  });
}

function extractOtherSeasons($: cheerio.CheerioAPI): SeasonLink[] {
  const seasons: SeasonLink[] = [];
  const seen = new Set<string>();

  $("#autres-saisons-posters .season-card a, .seasons-container .season-card a").each((_, el) => {
    const $a = $(el);
    const href = absUrl(clean($a.attr("href")) ?? "");
    if (!href) return;
    if (seen.has(href)) return;
    seen.add(href);
    const titre = clean($a.find(".season-title").text()) ?? clean($a.text()) ?? "Saison";
    const number = titre.match(/saison\s*(\d+)/i)?.[1];
    seasons.push({
      number: number ? Number(number) : null,
      url: href,
      titre,
    });
  });

  return seasons;
}

/**
 * Parse une page série.
 * @param html HTML de la page série
 * @param url URL canonique de la page
 * @param extraIframes Iframes collectées dynamiquement (clics), typiquement vides pour une série
 * @param movieBase Optionnel : si la métadonnée a déjà été extraite via parseMovie, on réutilise
 */
export function parseSeries(
  html: string,
  url: string,
  extraIframes?: StreamSource[],
  movieBase?: MovieInfo,
): SeriesInfo {
  const $ = cheerio.load(html);
  const { finfo, finfoMap } = extractFlist($);

  // Métadonnées communes : soit depuis movieBase fourni, soit re-extraites.
  const annee =
    movieBase?.annee ??
    parseYear(finfoMap["date de sortie"] ?? null) ??
    parseYear($(".year, .annee, .date").first().text());

  const h1El = $("#s-title, h1").first();
  h1El.find(".release_date, .tag").remove();
  const h1 = clean(h1El.text());
  const titre = metaContent($, ["og:title"]) ?? h1 ?? movieBase?.titre ?? null;

  const titreOriginal = finfoMap["titre original"] ?? movieBase?.titreOriginal ?? null;

  const description =
    (clean($(".fdesc").clone().find(".desc-text").remove().end().text()) ||
      clean($(".fdesc .desc-text").nextAll().text()) ||
      clean($(".fdesc").text()) ||
      metaContent($, ["og:description", "twitter:description", "description"])) ??
    movieBase?.description ??
    null;

  const genres =
    finfo["genre"]?.length
      ? finfo["genre"]
      : movieBase?.genres ??
        splitList(
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
  const acteurs = movieBase?.acteurs ?? [...new Set(acteursRaw)];

  const realisation =
    finfo["réalisateur"] ??
    finfo["realisateur"] ??
    movieBase?.realisation ??
    splitList(
      $(".director a, [itemprop=director], .realisation a")
        .map((_, e) => $(e).text())
        .get()
        .join(","),
    );

  const pays =
    finfo["pays"] ??
    movieBase?.pays ??
    splitList(
      $(".country a, [itemprop=countryOfOrigin] a, .pays a")
        .map((_, e) => $(e).text())
        .get()
        .join(","),
    );

  const langue = finfo["langue d'origine"] ?? finfo["langue"] ?? movieBase?.langue ?? [];

  const dureeRaw = clean($(".facts .runtime, .runtime, [itemprop=duration]").first().text());
  const duree = dureeRaw ? dureeRaw.replace(/^[-–—\s]+/, "").trim() || null : null;

  const noteStr =
    clean($(".vote-score, .imdb-score, [itemprop=ratingValue]").first().text()) ??
    metaContent($, ["og:rating"]);
  const noteMatch = noteStr?.match(/(\d+(?:[.,]\d+)?)/) ?? null;
  const note = noteMatch ? Number(noteMatch[1].replace(",", ".")) : (movieBase?.note ?? null);

  const poster =
    clean($(".fposter img").attr("src")) ??
    clean($('img[alt*="affiche"]').attr("src")) ??
    metaContent($, ["og:image", "twitter:image"]) ??
    movieBase?.poster ??
    null;

  const backdrop =
    clean($(".fmain").attr("style")?.match(/url\(([^)]+)\)/)?.[1] ?? "") ??
    metaContent($, ["og:image:secure_url"]) ??
    movieBase?.backdrop ??
    null;

  const qualite = finfo["qualité"] ?? finfo["qualite"] ?? movieBase?.qualite ?? [];
  const version = finfo["version"] ?? movieBase?.version ?? [];

  const seasonNumber = extractSeasonNumberFromTitle(titre, url);
  const status = finfoMap["statut"] ?? finfoMap["état"] ?? null;
  void hostFromUrl;

  return {
    url,
    titre,
    titreOriginal,
    description,
    annee,
    dateSortie: movieBase?.dateSortie ?? finfoMap["date de sortie"] ?? null,
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
    seasonNumber,
    status,
    episodes: extractEpisodes($),
    otherSeasons: extractOtherSeasons($),
    iframes: [...(extraIframes ?? []), ...extractIframes(html)],
    scrapedAt: new Date().toISOString(),
  };
}
