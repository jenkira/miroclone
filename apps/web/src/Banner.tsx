import { markerLabel, markingFor, useClassifications } from "./classifications.js";

/** Shows the classification in text and colour (PMK-2), followed by any markers and caveats (PMK-6). */
export function Banner({ classification, markers = [] }: { classification: string; markers?: string[] }) {
  const { list, markers: defs } = useClassifications();
  const c = markingFor(list, classification);
  return (
    <div role="banner" style={{ background: c.colour, color: "#fff", textAlign: "center", fontWeight: 700, padding: "2px 0" }}>
      {[c.label, ...markers.map((m) => markerLabel(defs, m))].join(" // ")}
    </div>
  );
}
