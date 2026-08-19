import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DBOrTx } from "../client";
import { actors, directors, genres, countries } from "../schema/index";
import type { MovieInfo, SeriesInfo } from "../../src/schema";

export function movieMetaHash(m: MovieInfo): string {
  const stable = {
    titre: m.titre,
    titreOriginal: m.titreOriginal,
    description: m.description,
    annee: m.annee,
    dateSortie: m.dateSortie,
    categories: m.categories,
    genres: m.genres,
    pays: m.pays,
    realisation: m.realisation,
    acteurs: m.acteurs,
    duree: m.duree,
    note: m.note,
    qualite: m.qualite,
    version: m.version,
    langue: m.langue,
  };
  return createHash("sha1").update(JSON.stringify(stable)).digest("hex");
}

export function seriesMetaHash(s: SeriesInfo): string {
  const stable = {
    titre: s.titre,
    titreOriginal: s.titreOriginal,
    description: s.description,
    annee: s.annee,
    genres: s.genres,
    realisation: s.realisation,
    acteurs: s.acteurs,
    note: s.note,
    seasonNumber: s.seasonNumber,
    status: s.status,
  };
  return createHash("sha1").update(JSON.stringify(stable)).digest("hex");
}

type RefTable = typeof actors | typeof directors | typeof genres | typeof countries;

/**
 * Upsert un nom dans un référentiel (actors/directors/genres/countries).
 * Retourne l'ID. Utilise un cast `any` car Drizzle type chaque table par son nom,
 * ce qui empêche le passage générique entre tables de même shape.
 */
export async function upsertRef(
  tx: DBOrTx,
  table: RefTable,
  name: string,
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = table as any;
  const [row] = await tx
    .insert(t)
    .values({ name })
    .onConflictDoUpdate({ target: t.name, set: { name } })
    .returning({ id: t.id });
  return row.id as number;
}

export { eq };
