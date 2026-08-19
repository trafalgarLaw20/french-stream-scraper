export type LangueCode = "VOSTFR" | "VF-FR" | "VF-QC" | "DEFAUT" | "AUTRE";

export function detectLangue(label: string | null | undefined): LangueCode {
  if (!label) return "AUTRE";
  const l = label.toUpperCase();
  if (/\bVFF\b|TRUEFRENCH|TRUE\s*FRENCH|VF1\b/.test(l)) return "VF-FR";
  if (/\bVFQ\b|\bFRENCH\b/.test(l)) return "VF-QC";
  if (/\bVOSTFR\b|\bVOST\b|\bVO\b/.test(l)) return "VOSTFR";
  if (/\(D[ÉE]FAUT\)|D[ÉE]FAUT/.test(l)) return "DEFAUT";
  return "AUTRE";
}
