import { useEffect, useState } from "react";
import { defaultClassifications } from "@miroclone/shared";
import { api, type BoardSummary, type Me, type OrgTemplate, type SearchHit, type TemplateInfo } from "./api.js";
import { snippetParts } from "./versions.js";
import { Banner } from "./Banner.js";
import { Notifications } from "./Notifications.js";
import { clearOfflineCache } from "./offline.js";

const filters = [["recent", "Recent"], ["owned", "Owned by me"], ["shared", "Shared with me"], ["starred", "Starred"], ["deleted", "Recycle bin"]] as const;

export function Dashboard({ me }: { me: Me }) {
  const [filter, setFilter] = useState<(typeof filters)[number][0]>("recent");
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [title, setTitle] = useState("");
  const [classification, setClassification] = useState("OFFICIAL");
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
  const load = () => api.boards(filter).then(setBoards);
  useEffect(() => { void load(); }, [filter]);

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 900, margin: "0 auto" }}>
      <Banner classification={classification} />
      <h1>Boards</h1>
      <p>Signed in as {me.name}. <Notifications /> <button onClick={async () => { await clearOfflineCache(); await api.logout(); location.reload(); }}>Sign out</button></p>
      <form onSubmit={async (e) => {
        e.preventDefault(); setCreateError("");
        try { const { id } = await api.createBoard(title, classification, template); location.hash = `#/board/${id}`; }
        catch { setCreateError("The board couldn't be created. A template from a higher classification needs a board at that level or above."); }
      }}>
        <label>Title <input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>{" "}
        <label>Classification{" "}
          <select value={classification} onChange={(e) => setClassification(e.target.value)}>
            {defaultClassifications.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
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
      <ul>
        {boards.map((b) => (
          <li key={b.id}>
            {filter === "deleted" ? b.title : <a href={`#/board/${b.id}`}>{b.title}</a>} <em>{b.classification}</em> ({b.role}){" "}
            {filter === "deleted"
              ? <button onClick={() => api.restoreBoard(b.id).then(load)}>Restore</button>
              : <>
                  <button aria-pressed={b.starred} onClick={() => api.star(b.id, !b.starred).then(load)}>{b.starred ? "Unstar" : "Star"}</button>
                  {b.role === "owner" && <button onClick={() => api.deleteBoard(b.id).then(load)}>Delete</button>}
                </>}
          </li>
        ))}
      </ul>
      {boards.length === 0 && <p>No boards to show.</p>}
    </main>
  );
}
