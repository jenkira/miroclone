import { createRoot } from "react-dom/client";
import * as Y from "yjs";
import { Banner } from "./Banner.js";
import { Canvas } from "./Canvas.js";

// R0 prototype: a local document. R1 connects it to the collaboration service.
const doc = new Y.Doc();
const classification = "OFFICIAL";

createRoot(document.getElementById("root")!).render(
  <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui" }}>
    <Banner classification={classification} />
    <Canvas doc={doc} readOnly={false} />
    <Banner classification={classification} />
  </div>,
);
