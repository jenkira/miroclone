import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { Board } from "@miroclone/shared";
import { api, type BoardSummary, type Me } from "./api.js";
import { Banner } from "./Banner.js";
import { Canvas, colourFor, type CanvasApi } from "./Canvas.js";
import { FormatBar } from "./FormatBar.js";
import { ExportMenu } from "./ExportMenu.js";
import { cacheBoard, clearOfflineCache } from "./offline.js";
import { ACCEPTED, MAX_BYTES, sizeFor, uploadMessage, useBoardImages } from "./images.js";
import { ShareDialog } from "./ShareDialog.js";
import { Toolbar } from "./Toolbar.js";
import type { Tool } from "./tools.js";

type Status = "connecting" | "connected" | "disconnected";

export function BoardView({ id, me }: { id: string; me: Me }) {
  const [meta, setMeta] = useState<BoardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [status, setStatus] = useState<Status>("connecting");
  const apiRef = useRef<CanvasApi | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [people, setPeople] = useState<{ id: number; name: string; colour: string }[]>([]);

  useEffect(() => { useBoardImages(id); return () => useBoardImages(undefined); }, [id]);
  useEffect(() => { api.board(id).then(setMeta).catch(() => setError("You can't open this board.")); }, [id]);

  const session = useMemo(() => {
    const doc = new Y.Doc();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const socket = new HocuspocusProviderWebsocket({ url: `${proto}://${location.host}/collab/${id}` });
    // The session cookie is the credential. The provider needs some token, or the server never starts authentication.
    const provider = new HocuspocusProvider({ name: id, document: doc, websocketProvider: socket, token: "cookie" });
    provider.awareness?.setLocalStateField("user", { name: me.name, colour: colourFor(doc.clientID) });
    const board = new Board(doc, doc.clientID);
    // End-to-end tests read the board through this hook. It exists only in the development server.
    if (import.meta.env.DEV) Object.assign(window, { __board: board, __provider: provider });
    return { doc, provider, socket, board };
  }, [id, me.name]);

  useEffect(() => {
    const { provider, socket, doc } = session;
    // A user who can reload offline also sees cached content, so the cache is cleared when the server ends the session.
    const stopCache = cacheBoard(id, doc);
    const onAuthFailed = () => { void clearOfflineCache(); };
    provider.on("authenticationFailed", onAuthFailed);
    const onStatus = ({ status: s }: { status: string }) => setStatus(s === "connected" ? "connected" : s === "connecting" ? "connecting" : "disconnected");
    provider.on("status", onStatus);
    const aw = provider.awareness!;
    const onAw = () => setPeople([...aw.getStates().entries()].filter(([, s]) => s.user).map(([cid, s]) => ({ id: cid, name: s.user.name, colour: s.user.colour })));
    aw.on("change", onAw); onAw();
    return () => { aw.off("change", onAw); provider.off("authenticationFailed", onAuthFailed); stopCache(); provider.destroy(); socket.destroy(); };
  }, [session, id]);

  if (error) return <p role="alert">{error}</p>;
  if (!meta) return <p>Loading board…</p>;
  const readOnly = meta.role === "viewer" || meta.role === "commenter";

  /** Uploads images and places each on the board, one after another so they don't overlap. */
  const addImages = async (files: File[], at: { x: number; y: number }) => {
    setNotice("");
    let offset = 0;
    for (const f of files) {
      if (!ACCEPTED.includes(f.type)) { setNotice(uploadMessage(415)); continue; }
      if (f.size > MAX_BYTES) { setNotice(uploadMessage(413)); continue; }
      try {
        const { id: fileId, mimeType } = await api.uploadFile(id, f);
        const size = await sizeFor(f);
        const obj = session.board.add({ type: "image", objectKey: fileId, mimeType, x: at.x - size.width / 2 + offset, y: at.y - size.height / 2 + offset, ...size } as never);
        apiRef.current?.select([obj.id]);
        offset += 24;
      } catch (e) {
        setNotice(uploadMessage((e as { status?: number }).status));
      }
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui" }}>
      <Banner classification={meta.classification} />
      <header style={{ display: "flex", gap: 12, alignItems: "center", padding: "4px 8px" }}>
        <a href="#/">Boards</a>
        <strong>{meta.title}</strong>
        <span aria-live="polite">{status === "connected" ? "Saved automatically" : status === "connecting" ? "Connecting…" : "Offline. Changes merge when you reconnect."}</span>
        {readOnly && <span>View only</span>}
        {!readOnly && <>
          <button onClick={() => fileInput.current?.click()}>Add image</button>
          <input ref={fileInput} type="file" accept={ACCEPTED.join(",")} multiple hidden aria-label="Choose images"
            onChange={(e) => { const c = apiRef.current; void addImages([...(e.target.files ?? [])], c ? c.viewCentre() : { x: 0, y: 0 }); e.target.value = ""; }} />
        </>}
        {meta.role === "owner" && <button onClick={() => setSharing(true)}>Share</button>}
        <ExportMenu board={session.board} title={meta.title} classification={meta.classification} selection={() => apiRef.current?.selection() ?? []}
          authorise={(format, scope) => api.recordExport(id, format, scope) as Promise<void>} loadImage={(fileId) => api.fetchFile(id, fileId)} />
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }} aria-label="People on this board">
          {people.map((p) => (
            <button key={p.id} title={p.id === session.doc.clientID ? "You" : `Go to ${p.name}`} disabled={p.id === session.doc.clientID}
              style={{ background: p.colour, color: "#fff", borderRadius: 12, padding: "0 8px", border: 0 }}
              onClick={() => { const c = session.provider.awareness?.getStates().get(p.id)?.cursor; if (c) apiRef.current?.centreOn(c); }}>
              {p.name}
            </button>
          ))}
        </span>
      </header>
      {notice && <p role="alert" style={{ margin: 0, padding: "2px 8px", background: "#fff3e0" }}>{notice}</p>}
      <Toolbar tool={tool} onChange={setTool} disabled={readOnly} />
      <FormatBar board={session.board} selection={selected} readOnly={readOnly} api={apiRef} />
      <Canvas apiRef={apiRef} onSelect={setSelected} onFiles={addImages} board={session.board} tool={tool} readOnly={readOnly} awareness={session.provider.awareness ?? undefined} onToolDone={() => setTool("select")} />
      <Banner classification={meta.classification} />
      {sharing && <ShareDialog boardId={id} onClose={() => setSharing(false)} />}
    </div>
  );
}
