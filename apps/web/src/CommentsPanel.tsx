import { useEffect, useRef, useState } from "react";
import { api, type Thread } from "./api.js";
import { activeMention, insertMention, renderBody } from "./mentions.js";

/** A text box that suggests people after you type `@`. */
function CommentBox({ boardId, placeholder, label, onSubmit }: { boardId: string; placeholder: string; label: string; onSubmit: (body: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { api.mentionable(boardId).then(setPeople).catch(() => setPeople([])); }, [boardId]);

  const at = activeMention(text, caret);
  const matches = at ? people.filter((p) => p.name.toLowerCase().includes(at.query.toLowerCase())).slice(0, 5) : [];
  const pick = (p: { id: string; name: string }) => {
    if (!at) return;
    const r = insertMention(text, at, p);
    setText(r.text); setCaret(r.caret);
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(r.caret, r.caret); });
  };
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await onSubmit(text.trim()); setText(""); } finally { setBusy(false); }
  };

  return (
    <div style={{ position: "relative" }}>
      <textarea ref={ref} aria-label={label} placeholder={placeholder} value={text} rows={2} style={{ width: "100%", boxSizing: "border-box" }}
        onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }} />
      {matches.length > 0 && (
        <ul role="listbox" aria-label="People to mention" style={{ position: "absolute", bottom: "100%", left: 0, background: "#fff", border: "1px solid #ccc", margin: 0, padding: 0, listStyle: "none", zIndex: 5 }}>
          {matches.map((p) => <li key={p.id} role="option" aria-selected={false}><button type="button" style={{ border: 0, background: "none", width: "100%", textAlign: "left" }} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>{p.name}</button></li>)}
        </ul>
      )}
      <button onClick={submit} disabled={busy || !text.trim()}>{label}</button>
    </div>
  );
}

/** Comment threads for a board (COL-7). Commenters and above can post, resolve, and reply. */
export function CommentsPanel({ boardId, threads, me, canComment, canModerate, selected, pending, onChanged, onSelect, onPlaced }: {
  boardId: string; threads: Thread[]; me: string; canComment: boolean; canModerate: boolean;
  selected?: string; pending?: { x: number; y: number; objectId?: string };
  onChanged: () => void; onSelect: (id: string | undefined) => void; onPlaced: () => void;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const open = threads.filter((t) => !t.resolved), done = threads.filter((t) => t.resolved);
  const act = (fn: () => Promise<unknown>) => fn().then(onChanged).catch(() => alert("That change failed."));

  const view = (t: Thread) => (
    <li key={t.id} aria-current={selected === t.id} style={{ border: selected === t.id ? "2px solid #1976d2" : "1px solid #ddd", margin: "6px 0", padding: 6, background: t.resolved ? "#f5f5f5" : "#fff" }}
      onClick={() => onSelect(t.id)}>
      {t.comments.map((c) => (
        <div key={c.id} style={{ margin: "4px 0" }}>
          <strong>{c.authorName}</strong> <small>{new Date(c.createdAt).toLocaleString("en-AU")}{c.editedAt ? " (edited)" : ""}</small>
          <div style={{ whiteSpace: "pre-wrap" }}>{renderBody(c.body)}</div>
          {(c.authorId === me || canModerate) && <button aria-label={`Delete comment by ${c.authorName}`} onClick={() => { if (confirm("Delete this comment?")) void act(() => api.deleteComment(boardId, c.id)); }}>Delete</button>}
        </div>
      ))}
      {canComment && (
        <>
          <CommentBox boardId={boardId} label="Reply" placeholder="Reply. Type @ to mention someone." onSubmit={(body) => api.addComment(boardId, { body, threadId: t.id }).then(onChanged)} />
          <button onClick={() => act(() => api.resolveThread(boardId, t.id, !t.resolved))}>{t.resolved ? "Reopen" : "Resolve"}</button>
        </>
      )}
    </li>
  );

  return (
    <aside aria-label="Comments" style={{ width: 300, borderLeft: "1px solid #ddd", padding: 8, overflow: "auto", background: "#fafafa", font: "14px system-ui" }}>
      <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>Comments</h2>
      {pending && canComment && (
        <div style={{ border: "2px dashed #1976d2", padding: 6 }}>
          <p style={{ margin: "0 0 4px" }}>New comment{pending.objectId ? " on the selected object" : " at this spot"}</p>
          <CommentBox boardId={boardId} label="Comment" placeholder="Write a comment. Type @ to mention someone." onSubmit={async (body) => {
            const r = await api.addComment(boardId, { body, anchor: pending }); onChanged(); onSelect(r.threadId); onPlaced();
          }} />
          <button onClick={onPlaced}>Cancel</button>
        </div>
      )}
      {open.length === 0 && !pending && <p>No open comments. Choose the Comment tool and click the board to add one.</p>}
      <ul style={{ padding: 0, listStyle: "none" }}>{open.map(view)}</ul>
      {done.length > 0 && <button aria-expanded={showResolved} onClick={() => setShowResolved(!showResolved)}>{showResolved ? "Hide" : "Show"} {done.length} resolved</button>}
      {showResolved && <ul style={{ padding: 0, listStyle: "none" }}>{done.map(view)}</ul>}
    </aside>
  );
}
