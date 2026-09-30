import { findClassification } from "@miroclone/shared";

/** Shows the classification in text and colour (PMK-2). */
export function Banner({ classification }: { classification: string }) {
  const c = findClassification(classification);
  return (
    <div role="banner" style={{ background: c.colour, color: "#fff", textAlign: "center", fontWeight: 700, padding: "2px 0" }}>
      {c.label}
    </div>
  );
}
