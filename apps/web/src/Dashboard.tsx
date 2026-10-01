import { useEffect, useState } from "react";
import { api, type BoardSummary, type Me, type Member, type Person, type Space, type OrgTemplate, type SearchHit, type TemplateInfo } from "./api.js";
import { snippetParts } from "./versions.js";
import { Banner } from "./Banner.js";
import { useClassifications } from "./classifications.js";
import { Notifications } from "./Notifications.js";
import { clearOfflineCache } from "./offline.js";

const filters = [["recent", "Recent"], ["owned", "Owned by me"], ["shared", "Shared with me"], ["starred", "Starred"], ["archived", "Archived"], ["deleted", "Recycle bin"]] as const;

export function Dashboard({ me }: { me: Me }) {
  const [filter, setFilter] = useState<(typeof filters)[number][0]>("recent");
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [title, setTitle] = useState("");
  const cfg = useClassifications();
  const [chosen, setChosen] = useState<string | null>(null);
  // The administrator's default applies until the person picks something else.
  const classification = chosen ?? cfg.default;
  const setClassification = setChosen;
  const [templates, setTemplates] = useState<{ builtin: TemplateInfo[]; organisation: OrgTemplate[] }>({ builtin: [], organisation: [] });
  const [template, setTemplate] = useState("");
  const [createError, setCreateError] = useState("");
  useEffect(() => { api.templates().then(setTemplates).catch(() => {}); }, []);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  // Wait for a pause in typing before searching.
  useEffect(() => {
    if (query.trim().length < 2) { setHits(null); return; }
    const t = window.setTimeout(() => { api.search(query).then(setHits).catch(() => setHits([])); }, 300);
    return () => window.clearTimeout(t);
  }, [query]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  // "" shows every board, and a space ID narrows the list to that space (BRD-3).
  const [space, setSpace] = useState("");
  const loadSpaces = () => api.spaces().then(setSpaces).catch(() => {});
  useEffect(() => { void loadSpaces(); }, []);
  const load = () => api.boards(filter).then(setBoards);
  useEffect(() => { void load(); }, [filter]);
  const shown = space ? boards.filter((b) => b.space_id === space) : boards;
  const current = spaces.find((s) => s.id === space);

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 900, margin: "0 auto" }}>
      <Banner classification={classification} />
      <h1>Boards</h1>
      <p>Signed in as {me.name}. <Notifications />{me.isAdmin && <> <a href="#/admin">Administration</a></>} <button onClick={async () => { await clearOfflineCache(); await api.logout(); location.reload(); }}>Sign out</button></p>
      <form onSubmit={async (e) => {
        e.preventDefault(); setCreateError("");
        try { const { id } = await api.createBoard(title, classification, template); location.hash = `#/board/${id}`; }
        catch { setCreateError("The board couldn't be created. A template from a higher classification needs a board at that level or above."); }
      }}>
        <label>Title <input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>{" "}
        <label>Classification{" "}
          <select value={classification} onChange={(e) => setClassification(e.target.value)}>
            {cfg.list.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>{" "}
        <label>Start from{" "}
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="">Blank board</option>
            <optgroup label="Built-in templates">{templates.builtin.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
            {templates.organisation.length > 0 && <optgroup label="Organisation templates">{templates.organisation.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.classification})</option>)}</optgroup>}
          </select>
        </label>{" "}
        <button type="submit">Create board</button>
        <p role="alert">{createError}</p>
      </form>
      <p>
        <label>Import a board file{" "}
          <input type="file" accept="application/json,.json" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try { const { id } = await api.importBoard(await f.text()); location.hash = `#/board/${id}`; }
            catch { alert("The file couldn't be imported. Check that it's a Miroclone board file."); }
          }} />
        </label>
      </p>
      <p role="search">
        <label>Search boards <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Titles and board text" /></label>
      </p>
      {hits && (
        <section aria-label="Search results">
          {hits.length === 0 ? <p>No boards match.</p> : (
            <ul>
              {hits.map((h) => (
                <li key={h.id}>
                  <a href={`#/board/${h.id}`}>{h.title}</a> <em>{h.classification}</em> ({h.role})<br />
                  <small>{snippetParts(h.snippet).map((p, i) => p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>)}</small>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <nav aria-label="Board filters">{filters.map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</nav>
      <section aria-label="Spaces">
        <label>Space{" "}
          <select value={space} onChange={(e) => setSpace(e.target.value)}>
            <option value="">All boards</option>
            {spaces.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.boards})</option>)}
          </select>
        </label>{" "}
        <button onClick={async () => {
          const name = window.prompt("Name the new space. You can share it with people and groups.");
          if (name?.trim()) { const { id } = await api.createSpace(name); await loadSpaces(); setSpace(id); }
        }}>New space</button>
        {current?.role === "owner" && <>{" "}
          <button onClick={async () => {
            if (window.confirm(`Delete the space "${current.name}"? Its boards stay, and keep their own sharing.`)) { await api.deleteSpace(current.id); setSpace(""); await loadSpaces(); await load(); }
          }}>Delete space</button>
        </>}
        {current && <SpaceMembers space={current} />}
      </section>
      <ul>
        {shown.map((b) => (
          <li key={b.id}>
            <img src={`/api/boards/${b.id}/thumbnail`} alt="" width={96} height={64} loading="lazy" style={{ objectFit: "contain", verticalAlign: "middle", background: "#f5f5f5", marginRight: 8 }} />
            {filter === "deleted" ? b.title : <a href={`#/board/${b.id}`}>{b.title}</a>} <em>{b.classification}</em> ({b.role}){" "}
            {filter === "deleted"
              ? <button onClick={() => api.restoreBoard(b.id).then(load)}>Restore</button>
              : filter === "archived"
              ? (b.role === "owner" ? <button onClick={() => api.unarchiveBoard(b.id).then(load)}>Restore from archive</button> : <em>Read-only</em>)
              : <>
                  <button aria-pressed={b.starred} onClick={() => api.star(b.id, !b.starred).then(load)}>{b.starred ? "Unstar" : "Star"}</button>
                  {b.role === "owner" && <>
                    <label>{" "}Space{" "}
                      <select aria-label={`Space for ${b.title}`} value={b.space_id ?? ""}
                        onChange={(e) => api.moveToSpace(b.id, e.target.value || null).then(() => Promise.all([load(), loadSpaces()]))}>
                        <option value="">None</option>
                        {spaces.filter((s) => s.role === "owner" || s.role === "editor").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </label>{" "}
                    <button onClick={() => { if (window.confirm(`Archive "${b.title}"? It becomes read-only, and you can restore it from the Archived list.`)) void api.archiveBoard(b.id).then(() => Promise.all([load(), loadSpaces()])); }}>Archive</button>{" "}
                    <button onClick={() => api.deleteBoard(b.id).then(() => Promise.all([load(), loadSpaces()]))}>Delete</button>
                  </>}
                </>}
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p>No boards to show.</p>}
    </main>
  );
}

/** Lists who has access to a space, and lets a space owner add or remove people (BRD-3). */
function SpaceMembers({ space }: { space: Space }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [role, setRole] = useState("editor");
  const [message, setMessage] = useState("");
  const load = () => api.spaceMembers(space.id).then(setMembers).catch(() => {});
  useEffect(() => { void load(); }, [space.id]);
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const t = window.setTimeout(() => { api.people(query).then(setResults).catch(() => setMessage("The directory search failed.")); }, 300);
    return () => window.clearTimeout(t);
  }, [query]);
  const run = async (fn: () => Promise<unknown>) => {
    setMessage("");
    try { await fn(); await load(); } catch (e) { setMessage((e as { status?: number }).status === 400 ? "A space needs at least one owner." : "That change failed."); }
  };
  const owner = space.role === "owner";
  return (
    <details>
      <summary>People in {space.name}</summary>
      <ul aria-label="Space members">
        {members.map((m) => (
          <li key={`${m.type}:${m.id}`}>{m.name} <em>{m.type}, {m.role}</em>{" "}
            {owner && <button onClick={() => run(() => api.unshareSpace(space.id, m))}>Remove</button>}
          </li>
        ))}
      </ul>
      {owner && <>
        <label>Add people or groups <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email" /></label>{" "}
        <label>Role{" "}<select value={role} onChange={(e) => setRole(e.target.value)}>{["viewer", "commenter", "editor", "owner"].map((r) => <option key={r}>{r}</option>)}</select></label>
        <ul aria-label="Space search results">
          {results.map((p) => <li key={`${p.type}:${p.id}`}>{p.name} <em>{p.type}</em>{" "}
            <button onClick={() => run(async () => { await api.shareSpace(space.id, p, role); setQuery(""); setResults([]); })}>Add as {role}</button></li>)}
        </ul>
      </>}
      <p role="alert">{message}</p>
    </details>
  );
}
