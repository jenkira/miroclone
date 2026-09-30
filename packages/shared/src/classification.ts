export interface Classification {
  /** Stable key, such as "PROTECTED". */
  key: string;
  label: string;
  /** Order from lowest (0) to highest. */
  level: number;
  /** Banner colour. */
  colour: string;
}

/** Default list that covers both frameworks (PMK-1). */
export const defaultClassifications: readonly Classification[] = [
  { key: "OFFICIAL", label: "OFFICIAL", level: 0, colour: "#2e7d32" },
  {
    key: "OFFICIAL_SENSITIVE",
    label: "OFFICIAL: Sensitive",
    level: 1,
    colour: "#ef6c00",
  },
  { key: "SENSITIVE", label: "SENSITIVE", level: 1, colour: "#ef6c00" },
  { key: "PROTECTED", label: "PROTECTED", level: 2, colour: "#c62828" },
];

export function findClassification(
  key: string,
  list: readonly Classification[] = defaultClassifications,
): Classification {
  const found = list.find((c) => c.key === key);
  if (!found) throw new Error(`Unknown classification: ${key}`);
  return found;
}

/**
 * Compares by level, so equivalent markings across the two frameworks compare
 * as equal (PMK-7). Returns a negative number when a is lower than b.
 */
export function compareClassification(
  a: string,
  b: string,
  list: readonly Classification[] = defaultClassifications,
): number {
  return findClassification(a, list).level - findClassification(b, list).level;
}

/** True when pasting from source into target lowers the classification (PMK-5). */
export function isDowngrade(
  source: string,
  target: string,
  list: readonly Classification[] = defaultClassifications,
): boolean {
  return compareClassification(target, source, list) < 0;
}

/** Lowering a classification needs owner confirmation and a reason (PMK-3). */
export function validateClassificationChange(
  from: string,
  to: string,
  opts: { confirmed?: boolean; reason?: string },
  list: readonly Classification[] = defaultClassifications,
): { ok: true } | { ok: false; error: string } {
  if (compareClassification(to, from, list) >= 0) return { ok: true };
  if (!opts.confirmed) return { ok: false, error: "Owner must confirm." };
  if (!opts.reason?.trim()) return { ok: false, error: "Reason is required." };
  return { ok: true };
}
