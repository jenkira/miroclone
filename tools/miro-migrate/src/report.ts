import type { Conversion, Outcome, ReportItem } from "./convert.js";

export interface BoardReport {
  miroBoardId: string;
  title: string;
  generatedAt: string;
  totals: Record<Outcome, number> & { items: number };
  byType: Record<string, Partial<Record<Outcome, number>>>;
  items: ReportItem[];
}

/** Summarises a conversion for the administrator (MIG-4). The report never holds the access token or item content. */
export function buildReport(miroBoardId: string, c: Conversion, now = new Date()): BoardReport {
  const totals = { items: c.items.length, converted: 0, approximated: 0, placeholder: 0, error: 0 };
  const byType: BoardReport["byType"] = {};
  for (const i of c.items) {
    totals[i.outcome]++;
    const row = (byType[i.type] ??= {});
    row[i.outcome] = (row[i.outcome] ?? 0) + 1;
  }
  return { miroBoardId, title: c.title, generatedAt: now.toISOString(), totals, byType, items: c.items };
}

const fmt = (d: string) => {
  const t = new Date(d);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${t.getUTCDate()} ${months[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
};

/** Writes the report as Markdown that a person can read, with the problems listed first. */
export function reportMarkdown(r: BoardReport): string {
  const t = r.totals;
  const lines = [
    `# Migration report: ${r.title}`,
    "",
    `Miro board ID: ${r.miroBoardId}. Generated on ${fmt(r.generatedAt)}.`,
    "",
    `The tool read ${t.items} items and ${t.converted} converted without changes. ` +
      `${t.approximated} converted with a difference, ${t.placeholder} became a placeholder, and ${t.error} failed.`,
    "",
  ];
  const section = (heading: string, intro: string, outcome: Outcome) => {
    const rows = r.items.filter((i) => i.outcome === outcome);
    if (!rows.length) return;
    lines.push(`## ${heading}`, "", intro, "");
    for (const i of rows) lines.push(`- ${i.type} ${i.id}${i.detail ? `: ${i.detail}` : ""}`);
    lines.push("");
  };
  section("Errors", "The tool couldn't convert the following items. Each one has a grey placeholder where it sat, or was left out.", "error");
  section("Placeholders", "Miroclone has no equivalent for the following items, so each one became a grey sticky note that names the original type.", "placeholder");
  section("Converted with a difference", "The following items converted, but some detail changed.", "approximated");
  lines.push("## Items by type", "", "The following table counts the outcome for each Miro item type.", "",
    "| Item type | Converted | With a difference | Placeholder | Error |", "|---|---|---|---|---|");
  for (const [type, row] of Object.entries(r.byType).sort()) {
    lines.push(`| ${type} | ${row.converted ?? 0} | ${row.approximated ?? 0} | ${row.placeholder ?? 0} | ${row.error ?? 0} |`);
  }
  lines.push("");
  return lines.join("\n");
}
