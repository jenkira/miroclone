// PixiJS compiles shaders with new Function by default, which the Content Security Policy blocks (PRD section 7.4).
import "pixi.js/unsafe-eval";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, type Me } from "./api.js";
import { BoardView } from "./BoardView.js";
import { Dashboard } from "./Dashboard.js";
import { Local } from "./Local.js";
import { clearOfflineCache } from "./offline.js";

function useHash() {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => setH(location.hash); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  return h;
}

function App() {
  const hash = useHash();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  // Local boards need no sign-in. They exist for development and performance checks.
  const local = /^#\/local(?:\/(\d+))?$/.exec(hash);
  useEffect(() => { if (!local) api.me().then(setMe).catch(() => { setMe(null); void clearOfflineCache(); }); }, [!!local]);
  if (local) return <Local objects={Number(local[1] ?? 0)} />;

  if (me === undefined) return <p>Loading…</p>;
  if (me === null) return <main style={{ fontFamily: "system-ui" }}><h1>Miroclone</h1><p><a href="/auth/login">Sign in with Microsoft</a></p></main>;
  const board = /^#\/board\/([0-9a-f-]+)$/.exec(hash);
  return board ? <BoardView id={board[1]!} me={me} /> : <Dashboard me={me} />;
}

createRoot(document.getElementById("root")!).render(<App />);
