/** Splits text into display lines and adds list markers to each paragraph (CNV-4). */
export function listLines(text: string, list: "none" | "bullet" | "number"): string[] {
  const paras = text.split("\n");
  if (list === "none") return paras;
  return paras.map((p, i) => (list === "bullet" ? `• ${p}` : `${i + 1}. ${p}`));
}

/** Breaks text into lines of at most `max` characters. Long words break too, so nothing runs outside its box. */
export function wrapText(text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (word.length > max) {
        if (line) { out.push(line); line = ""; }
        out.push(word.slice(0, max));
        word = word.slice(max);
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= max) line += ` ${word}`;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

/** True when a due date (2026-09-30) is before `today`, which is also in that form. */
export const isOverdue = (due: string | undefined, today: string): boolean => !!due && due < today;

/** Formats a due date as "30 September 2026". */
export function formatDue(due: string): string {
  const [y, m, d] = due.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}
