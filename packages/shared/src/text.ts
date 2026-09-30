/** Splits text into display lines and adds list markers to each paragraph (CNV-4). */
export function listLines(text: string, list: "none" | "bullet" | "number"): string[] {
  const paras = text.split("\n");
  if (list === "none") return paras;
  return paras.map((p, i) => (list === "bullet" ? `• ${p}` : `${i + 1}. ${p}`));
}
