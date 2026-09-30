import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { Board } from "@miroclone/shared";
import { api, type BoardSummary, type Me, type Thread } from "./api.js";
import { Banner } from "./Banner.js";
import { Canvas, colourFor, type CanvasApi } from "./Canvas.js";
import { FormatBar } from "./FormatBar.js";
import { CommentsPanel } from "./CommentsPanel.js";
import { ExportMenu } from "./ExportMenu.js";
import { HistoryPanel } from "./HistoryPanel.js";
import { Notifications } from "./Notifications.js";
import { pinsFor } from "./pins.js";
import { cacheBoard, clearOfflineCache } from "./offline.js";
import { ACCEPTED, MAX_BYTES, sizeFor, uploadMessage, useBoardImages } from "./images.js";
import { ShareDialog } from "./ShareDialog.js";
import { contentOfSelection } from "./selection.js";
import { useVoting } from "./useVoting.js";
import { useWorkshop } from "./useWorkshop.js";
import { VotePanel } from "./VotePanel.js";
import { WorkshopBar } from "./WorkshopBar.js";
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
  const [threads, setThreads] = useState<Thread[]>([]);
  // One side panel at a time.
  const [panel, setPanel] = useState<"comments" | "history" | "voting" | null>(null);
  const showComments = panel === "comments";
  const setShowComments = (on: boolean) => setPanel(on ? "comments" : null);
  const [selectedThread, setSelectedThread] = useState<string>();
  const [pending, setPending] = useState<{ x: number; y: number; objectId?: string }>();
  const [, bump] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [people, setPeople] = useState<{ id: number; name: string; colour: string }[]>([]);

  const loadThreads = () => api.threads(id).then(setThreads).catch(() => {});
  useEffect(() => {
    void loadThreads();
    // Comments refresh every few seconds while the tab is visible.
    const t = window.setInterval(() => { if (!document.hidden) void loadThreads(); }, 6000);
    return () => window.clearInterval(t);
  }, [id]);
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
    const onObjs = () => bump((n) => n + 1);
    session.board.objects.observe(onObjs);
    // A user who can reload offline also sees cached content, so the cache is cleared when the server ends the session.
    const stopCache = cacheBoard(id, doc);
    const onAuthFailed = () => { void clearOfflineCache(); };
    provider.on("authenticationFailed", onAuthFailed);
    const onStatus = ({ status: s }: { status: string }) => setStatus(s === "connected" ? "connected" : s === "connecting" ? "connecting" : "disconnected");
    provider.on("status", onStatus);
    const aw = provider.awareness!;
    const onAw = () => setPeople([...aw.getStates().entries()].filter(([, s]) => s.user).map(([cid, s]) => ({ id: cid, name: s.user.name, colour: s.user.colour })));
    aw.on("change", onAw); onAw();
    return () => { session.board.objects.unobserve(onObjs); aw.off("change", onAw); provider.off("authenticationFailed", onAuthFailed); stopCache(); provider.destroy(); socket.destroy(); };
  }, [session, id]);

  // These hooks run before the early returns below, so they always run in the same order.
  const facilitator = meta?.role === "owner" || meta?.role === "editor";
  const w = useWorkshop({ doc: session.doc, board: session.board, awareness: session.provider.awareness ?? undefined, me, canFacilitate: !!facilitator, apiRef });
  const voting = useVoting(id);
  useEffect(() => { if (import.meta.env.DEV) Object.assign(window, { __apiRef: apiRef }); }, []);

  if (error) return <p role="alert">{error}</p>;
  if (!meta) return <p>Loading board…</p>;
  const readOnly = meta.role === "viewer" || meta.role === "commenter";
  const canComment = meta.role !== "viewer";
  const canModerate = meta.role === "owner" || meta.role === "editor";

  /** Saves the selection, or the whole board, as a template for the organisation (WSH-2). */
  const saveTemplate = async () => {
    const sel = apiRef.current?.selection() ?? [];
    const what = sel.length ? "the selected objects" : "this whole board";
    const name = window.prompt(`Name the template. Everyone in the organisation can use ${what} as a starting point, at ${meta.classification} or higher.`);
    if (!name?.trim()) return;
    try {
      await api.saveTemplate(id, name.trim(), sel.length ? contentOfSelection(session.board.list(), sel) : undefined);
      setNotice(`Saved the template "${name.trim()}".`);
    } catch (e) {
      setNotice((e as { status?: number }).status === 403 ? "Only editors can save templates." : "The template couldn't be saved.");
    }
  };
  // Pins follow their objects, so they're recomputed when objects change.
  const pins = pinsFor(threads, (oid) => session.board.get(oid));

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
        {canModerate && <button onClick={saveTemplate}>Save as template</button>}
        <button aria-pressed={panel === "voting"} onClick={() => setPanel(panel === "voting" ? null : "voting")}>Voting{voting.open ? " (open)" : ""}</button>
        {!readOnly && <button aria-pressed={panel === "history"} onClick={() => setPanel(panel === "history" ? null : "history")}>History</button>}
        <button aria-pressed={showComments} onClick={() => setShowComments(!showComments)}>Comments{threads.filter((t) => !t.resolved).length ? ` (${threads.filter((t) => !t.resolved).length})` : ""}</button>
        <Notifications />
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }} aria-label="People on this board">
          {people.map((p) => (
            <button key={p.id} title={p.id === session.doc.clientID ? "You" : `Go to ${p.name}`} disabled={p.id === session.doc.clientID}
              style={{ background: p.colour, color: "#fff", borderRadius: 12, padding: "0 8px", border: 0 }}
              onClick={() => { const c = session.provider.awareness?.getStates().get(p.id)?.cursor; if (c) apiRef.current?.centreOn(c); }}>
              {p.name}
            </button>
          ))}
          {people.filter((p) => p.id !== session.doc.clientID).map((p) => (
            <button key={`f${p.id}`} aria-pressed={w.followId === p.id} title={`Follow ${p.name}'s view`} onClick={() => w.setFollowId(w.followId === p.id ? null : p.id)}>
              {w.followId === p.id ? "Following" : "Follow"} {p.name.split(" ")[0]}
            </button>
          ))}
        </span>
      </header>
      {notice && <p role="alert" style={{ margin: 0, padding: "2px 8px", background: "#fff3e0" }}>{notice}</p>}
      <Toolbar tool={tool} onChange={(t) => { setTool(t); if (t === "comment") setShowComments(true); if (t === "vote") setPanel("voting"); }} disabled={readOnly} canComment={canComment} canVote={canComment} />
      <FormatBar board={session.board} selection={selected} readOnly={readOnly} api={apiRef} />
      <WorkshopBar w={w} />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Canvas apiRef={apiRef} onSelect={setSelected} onFiles={addImages} board={session.board} tool={tool} readOnly={readOnly} awareness={session.provider.awareness ?? undefined}
            onToolDone={() => setTool("select")}
            pins={pins} selectedPin={selectedThread} canComment={canComment}
            badges={voting.badges} canVote={canComment && voting.open} onVote={(oid, remove) => void voting.cast(oid, remove)} onViewChange={w.onViewChange}
            onPinClick={(tid) => { setSelectedThread(tid); setShowComments(true); }}
            onComment={(at) => { setPending(at); setShowComments(true); }} />
        </div>
        {panel === "voting" && <VotePanel v={voting} board={session.board} canFacilitate={!!facilitator} canVote={canComment} />}
        {panel === "history" && !readOnly && <HistoryPanel boardId={id} board={session.board} canDelete={meta.role === "owner"} />}
        {showComments && (
          <CommentsPanel boardId={id} threads={threads} me={me.id} canComment={canComment} canModerate={canModerate}
            selected={selectedThread} pending={pending} onChanged={() => void loadThreads()}
            onSelect={setSelectedThread} onPlaced={() => { setPending(undefined); setTool("select"); }} />
        )}
      </div>
      <Banner classification={meta.classification} />
      {sharing && <ShareDialog boardId={id} onClose={() => setSharing(false)} />}
    </div>
  );
}
