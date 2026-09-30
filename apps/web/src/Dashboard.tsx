import { useEffect, useState } from "react";
import { defaultClassifications } from "@miroclone/shared";
import { api, type BoardSummary, type Me } from "./api.js";
import { Banner } from "./Banner.js";

const filters = [["recent", "Recent"], ["owned", "Owned by me"], ["shared", "Shared with me"], ["starred", "Starred"], ["deleted", "Recycle bin"]] as const;

export function Dashboard({ me }: { me: Me }) {
  const [filter, setFilter] = useState<(typeof filters)[number][0]>("recent");
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [title, setTitle] = useState("");
  const [classification, setClassification] = useState("OFFICIAL");
  const load = () => api.boards(filter).then(setBoards);
  useEffect(() => { void load(); }, [filter]);

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 900, margin: "0 auto" }}>
      <Banner classification={classification} />
      <h1>Boards</h1>
      <p>Signed in as {me.name}. <button onClick={() => api.logout().then(() => location.reload())}>Sign out</button></p>
      <form onSubmit={async (e) => { e.preventDefault(); const { id } = await api.createBoard(title, classification); location.hash = `#/board/${id}`; }}>
        <label>Title <input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>{" "}
        <label>Classification{" "}
          <select value={classification} onChange={(e) => setClassification(e.target.value)}>
            {defaultClassifications.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>{" "}
        <button type="submit">Create board</button>
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
