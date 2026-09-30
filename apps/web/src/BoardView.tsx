import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { Board } from "@miroclone/shared";
import { api, type BoardSummary, type Me } from "./api.js";
import { Banner } from "./Banner.js";
import { Canvas, colourFor } from "./Canvas.js";
import { ExportMenu } from "./ExportMenu.js";
import { Toolbar } from "./Toolbar.js";
import type { Tool } from "./tools.js";

type Status = "connecting" | "connected" | "disconnected";

export function BoardView({ id, me }: { id: string; me: Me }) {
  const [meta, setMeta] = useState<BoardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [status, setStatus] = useState<Status>("connecting");
  const selectionRef = useRef<() => string[]>(() => []);
  const [people, setPeople] = useState<{ id: number; name: string; colour: string }[]>([]);

  useEffect(() => { api.board(id).then(setMeta).catch(() => setError("You can't open this board.")); }, [id]);

  const session = useMemo(() => {
    const doc = new Y.Doc();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const socket = new HocuspocusProviderWebsocket({ url: `${proto}://${location.host}/collab/${id}` });
    // The session cookie is the credential. The provider needs some token, or the server never starts authentication.
    const provider = new HocuspocusProvider({ name: id, document: doc, websocketProvider: socket, token: "cookie" });
    provider.awareness?.setLocalStateField("user", { name: me.name, colour: colourFor(doc.clientID) });
    return { doc, provider, socket, board: new Board(doc, doc.clientID) };
  }, [id, me.name]);

  useEffect(() => {
    const { provider, socket } = session;
    const onStatus = ({ status: s }: { status: string }) => setStatus(s === "connected" ? "connected" : s === "connecting" ? "connecting" : "disconnected");
    provider.on("status", onStatus);
    const aw = provider.awareness!;
    const onAw = () => setPeople([...aw.getStates().entries()].filter(([, s]) => s.user).map(([cid, s]) => ({ id: cid, name: s.user.name, colour: s.user.colour })));
    aw.on("change", onAw); onAw();
    return () => { aw.off("change", onAw); provider.destroy(); socket.destroy(); };
  }, [session]);

  if (error) return <p role="alert">{error}</p>;
  if (!meta) return <p>Loading board…</p>;
  const readOnly = meta.role === "viewer" || meta.role === "commenter";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui" }}>
      <Banner classification={meta.classification} />
      <header style={{ display: "flex", gap: 12, alignItems: "center", padding: "4px 8px" }}>
        <a href="#/">Boards</a>
        <strong>{meta.title}</strong>
        <span aria-live="polite">{status === "connected" ? "Saved automatically" : status === "connecting" ? "Connecting…" : "Offline. Changes merge when you reconnect."}</span>
        {readOnly && <span>View only</span>}
        <ExportMenu board={session.board} title={meta.title} classification={meta.classification} selection={() => selectionRef.current()}
          authorise={(format, scope) => api.recordExport(id, format, scope) as Promise<void>} />
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }} aria-label="People on this board">
          {people.map((p) => <span key={p.id} title={p.name} style={{ background: p.colour, color: "#fff", borderRadius: 12, padding: "0 8px" }}>{p.name}</span>)}
        </span>
      </header>
      <Toolbar tool={tool} onChange={setTool} disabled={readOnly} />
      <Canvas selectionRef={selectionRef} board={session.board} tool={tool} readOnly={readOnly} awareness={session.provider.awareness ?? undefined} onToolDone={() => setTool("select")} />
      <Banner classification={meta.classification} />
    </div>
  );
}
