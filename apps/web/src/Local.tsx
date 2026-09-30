import { useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { Board } from "@miroclone/shared";
import { Banner } from "./Banner.js";
import { Canvas, type CanvasApi } from "./Canvas.js";
import { FormatBar } from "./FormatBar.js";
import { ExportMenu } from "./ExportMenu.js";
import { Toolbar } from "./Toolbar.js";
import type { Tool } from "./tools.js";

/** Local-only board for development and the performance prototype. Nothing syncs or persists. */
export function Local({ objects }: { objects: number }) {
  const [tool, setTool] = useState<Tool>("select");
  const apiRef = useRef<CanvasApi | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const board = useMemo(() => {
    const b = new Board(new Y.Doc());
    b.doc.transact(() => {
      const cols = Math.ceil(Math.sqrt(objects));
      for (let i = 0; i < objects; i++) {
        b.add(i % 3 === 0
          ? { type: "sticky", x: (i % cols) * 190, y: Math.floor(i / cols) * 190, width: 160, height: 160, text: `Note ${i}` }
          : { type: "shape", kind: i % 3 === 1 ? "rectangle" : "ellipse", x: (i % cols) * 190, y: Math.floor(i / cols) * 190, width: 160, height: 120 });
      }
    });
    (window as unknown as { __board: Board }).__board = b;
    return b;
  }, [objects]);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Banner classification="OFFICIAL" />
      <Toolbar tool={tool} onChange={setTool} disabled={false} />
      <FormatBar board={board} selection={selected} readOnly={false} api={apiRef} />
      <ExportMenu board={board} title="Local board" classification="OFFICIAL" selection={() => apiRef.current?.selection() ?? []} authorise={async () => {}} />
      <Canvas apiRef={apiRef} onSelect={setSelected} board={board} tool={tool} readOnly={false} onToolDone={() => setTool("select")} />
      <Banner classification="OFFICIAL" />
    </div>
  );
}
