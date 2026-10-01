import { useEffect, useState } from "react";
import { api, type Notification } from "./api.js";

/** The bell in the header: unread mentions and replies (COL-8). Opening the list marks them read. */
export function Notifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const load = () => api.notifications().then(setItems).catch(() => {});
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, 15_000);
    return () => window.clearInterval(t);
  }, []);
  const unread = items.filter((n) => !n.read).length;

  return (
    <span style={{ position: "relative" }}>
      <button aria-expanded={open} aria-label={`Notifications, ${unread} unread`} onClick={() => { setOpen(!open); if (!open && unread) void api.markRead().then(load); }}>
        Notifications{unread > 0 ? ` (${unread})` : ""}
      </button>
      {open && (
        <ul aria-label="Notifications" style={{ position: "absolute", right: 0, top: "100%", background: "#fff", border: "1px solid #ccc", width: 320, margin: 0, padding: 4, listStyle: "none", zIndex: 20, maxHeight: 320, overflow: "auto" }}>
          {items.length === 0 && <li>No notifications.</li>}
          {items.map((n) => (
            <li key={n.id} style={{ padding: "4px 2px", fontWeight: n.read ? 400 : 700 }}>
              <a href={`#/board/${n.boardId}`} onClick={() => setOpen(false)}>
                {n.actorName} {n.kind === "mention" ? "mentioned you" : "replied"} on {n.boardTitle}
              </a>{" "}
              <em>{n.classification}</em>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
