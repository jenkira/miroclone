import { useState } from "react";
import type { Board } from "@miroclone/shared";
import type { useVoting } from "./useVoting.js";

type V = ReturnType<typeof useVoting>;

/** Facilitators start and close voting. Everyone votes with the Vote tool. Results show after it closes (WSH-4). */
export function VotePanel({ v, board, canFacilitate, canVote }: { v: V; board: Board; canFacilitate: boolean; canVote: boolean }) {
  const [limit, setLimit] = useState(3);
  const [anonymous, setAnonymous] = useState(true);
  const s = v.state?.session;
  const label = (id: string) => {
    const o = board.get(id) as { text?: string; title?: string; type?: string } | undefined;
    return o ? (o.text || o.title || `a ${o.type}`).slice(0, 40) : "(removed object)";
  };

  return (
    <aside aria-label="Voting" style={{ width: 300, borderLeft: "1px solid #ddd", padding: 8, overflow: "auto", background: "#fafafa", font: "14px system-ui" }}>
      <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>Voting</h2>
      {(!s || s.state === "closed") && canFacilitate && (
        <form onSubmit={(e) => { e.preventDefault(); void v.start(limit, anonymous); }}>
          <label>Votes each <input type="number" min={1} max={50} value={limit} style={{ width: 56 }} onChange={(e) => setLimit(Number(e.target.value))} /></label><br />
          <label><input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Anonymous votes</label><br />
          <button type="submit">Start voting</button>
        </form>
      )}
      {!s && !canFacilitate && <p>No voting yet. A facilitator can start a round.</p>}
      {s?.state === "open" && (
        <>
          <p role="status"><strong>Voting is open.</strong> {s.anonymous ? "Votes are anonymous." : "Votes show names."}</p>
          {canVote
            ? <p>Choose the Vote tool and click an object to vote. Hold Alt and click to take a vote back. You have <strong>{v.state!.remaining}</strong> of {s.limit} votes left.</p>
            : <p>You can watch, but only people who can comment can vote.</p>}
          {canFacilitate && <button onClick={() => void v.close()}>Close voting and show results</button>}
        </>
      )}
      {s?.state === "closed" && (
        <>
          <p role="status"><strong>Voting is closed.</strong> {s.anonymous ? "The votes were anonymous." : ""}</p>
          {v.state!.results && v.state!.results.length === 0 && <p>Nobody voted.</p>}
          <ol aria-label="Results" style={{ paddingLeft: 20 }}>
            {v.state!.results?.map((r) => (
              <li key={r.objectId}>
                <strong>{r.count}</strong> {r.count === 1 ? "vote" : "votes"}: {label(r.objectId)}
                {r.voters && <><br /><small>{r.voters.join(", ")}</small></>}
              </li>
            ))}
          </ol>
        </>
      )}
      <p role="alert">{v.message}</p>
    </aside>
  );
}
