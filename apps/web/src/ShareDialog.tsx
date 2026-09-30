import { useEffect, useRef, useState } from "react";
import { boardRoles } from "@miroclone/shared";
import { api, type Member, type Person } from "./api.js";
import { useClassifications } from "./classifications.js";

/** Lets an owner share a board with people and Entra groups, and change or remove access (IAM-5, IAM-6). */
export function ShareDialog({ boardId, classification, onClose }: { boardId: string; classification?: string; onClose: () => void }) {
  const cfg = useClassifications();
  const level = (k?: string) => cfg.list.find((c) => c.key === k)?.level ?? 0;
  // PROTECTED boards can't be visible to the whole organisation (IAM-8).
  const protectedBoard = level(classification) >= (cfg.list.find((c) => c.key === "PROTECTED")?.level ?? 2);
  const [orgRole, setOrgRole] = useState<string>("");
  useEffect(() => { api.visibility(boardId).then((v) => setOrgRole(v.role ?? "")).catch(() => {}); }, [boardId]);
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [role, setRole] = useState("editor");
  const [message, setMessage] = useState("");
  const timer = useRef<number>();

  const load = () => api.members(boardId).then(setMembers).catch(() => setMessage("The member list couldn't be loaded."));
  useEffect(() => { void load(); }, [boardId]);

  // Wait for a pause in typing before searching, so each keystroke doesn't call Graph.
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (query.trim().length < 2) { setResults([]); return; }
    timer.current = window.setTimeout(() => {
      api.people(query).then(setResults).catch(() => setMessage("The directory search failed. Sign in again if this keeps happening."));
    }, 300);
    return () => window.clearTimeout(timer.current);
  }, [query]);

  const run = async (fn: () => Promise<unknown>) => {
    setMessage("");
    try { await fn(); await load(); } catch (e) { setMessage((e as { status?: number }).status === 400 ? "A board needs at least one owner." : "That change failed."); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Share board" style={{ position: "fixed", inset: 0, background: "#0006", display: "grid", placeItems: "center", zIndex: 10 }}>
      <div style={{ background: "#fff", padding: 16, width: 460, maxHeight: "80vh", overflow: "auto", font: "14px system-ui" }}>
        <h2>Share board</h2>
        <label>Add people or groups{" "}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email" autoFocus />
        </label>{" "}
        <label>Role{" "}
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {boardRoles.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <ul aria-label="Search results">
          {results.map((p) => (
            <li key={`${p.type}:${p.id}`}>
              {p.name} <em>{p.type}{p.email ? `, ${p.email}` : ""}</em>{" "}
              <button onClick={() => run(async () => { await api.share(boardId, p, role); setQuery(""); setResults([]); })}>Add as {role}</button>
            </li>
          ))}
        </ul>
        <h3>People with access</h3>
        <ul aria-label="Members">
          {members.map((m) => (
            <li key={`${m.type}:${m.id}`}>
              {m.name} <em>{m.type}</em>{" "}
              <select aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => run(() => api.share(boardId, { ...m }, e.target.value))}>
                {boardRoles.map((r) => <option key={r}>{r}</option>)}
              </select>{" "}
              <button onClick={() => run(() => api.unshare(boardId, m))}>Remove</button>
            </li>
          ))}
        </ul>
        <h3>Everyone in the organisation</h3>
        <label>Default role{" "}
          <select aria-label="Organisation-wide role" value={orgRole} disabled={protectedBoard}
            onChange={(e) => run(async () => { await api.setVisibility(boardId, e.target.value || null); setOrgRole(e.target.value); })}>
            <option value="">No access</option>
            {["viewer", "commenter", "editor"].map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        {protectedBoard && <p>A PROTECTED board can't be visible to the whole organisation.</p>}
        <h3>Transfer ownership</h3>
        <p>Choose a person from the list above. You become an editor.</p>
        <ul aria-label="Transfer ownership">
          {members.filter((m) => m.type === "user" && m.role !== "owner").map((m) => (
            <li key={m.id}>{m.name} <button onClick={() => { if (confirm(`Make ${m.name} the owner of this board? You become an editor.`)) void run(() => api.transfer(boardId, m.id)); }}>Make owner</button></li>
          ))}
        </ul>
        <p role="alert">{message}</p>
        <button onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
