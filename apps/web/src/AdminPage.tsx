import { useEffect, useState } from "react";
import { api, type ClassificationConfig, type MarkerDef, type Marking, type UsageStats } from "./api.js";
import { Banner } from "./Banner.js";
import { MigrationImport } from "./MigrationImport.js";

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

/** Usage statistics (ADM-3) and the classification markings (PMK-1, PMK-7). For service administrators. */
export function AdminPage() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [cfg, setCfg] = useState<ClassificationConfig | null>(null);
  const [message, setMessage] = useState("");
  const [markers, setMarkers] = useState<MarkerDef[] | null>(null);
  const [markerMessage, setMarkerMessage] = useState("");
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    api.stats().then(setStats).catch((e) => { if (e.status === 403) setForbidden(true); });
    api.classifications().then(setCfg).catch(() => {});
    api.markers().then(setMarkers).catch(() => {});
  }, []);

  if (forbidden) return <main><p role="alert">Only a service administrator can open this page. <a href="#/">Back to boards</a></p></main>;

  const edit = (i: number, patch: Partial<Marking>) => cfg && setCfg({ ...cfg, list: cfg.list.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const save = async () => {
    setMessage("");
    try { setCfg(await api.saveClassifications(cfg!)); setMessage("Saved."); }
    catch { setMessage("The markings weren't saved. Check that each key is unique, the default is in the list, and no marking that boards use was removed."); }
  };

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 900, margin: "0 auto" }}>
      <Banner classification={cfg?.default ?? "OFFICIAL"} />
      <p><a href="#/">Back to boards</a></p>
      <h1>Administration</h1>

      <h2>Usage</h2>
      {!stats ? <p>Loading…</p> : (
        <>
          <p>The following numbers count things only. They show no board content.</p>
          <table>
            <caption>Table 1. Usage</caption>
            <thead><tr><th scope="col">Measure</th><th scope="col">Value</th></tr></thead>
            <tbody>
              <tr><th scope="row">Users</th><td>{stats.users.total}</td></tr>
              <tr><th scope="row">Users who signed in within 7 days</th><td>{stats.users.activeLast7Days}</td></tr>
              <tr><th scope="row">Users who signed in within 30 days</th><td>{stats.users.activeLast30Days}</td></tr>
              <tr><th scope="row">Boards</th><td>{stats.boards.total} ({stats.boards.inRecycleBin} in the recycle bin)</td></tr>
              {stats.boards.byClassification.map((b) => <tr key={b.classification}><th scope="row">Boards marked {b.classification}</th><td>{b.count}</td></tr>)}
              <tr><th scope="row">Board content stored</th><td>{mb(stats.storage.documentBytes)}</td></tr>
              <tr><th scope="row">Saved versions stored</th><td>{mb(stats.storage.versionBytes)}</td></tr>
              <tr><th scope="row">Uploaded files</th><td>{stats.storage.fileCount} files, {mb(stats.storage.fileBytes)}</td></tr>
              <tr><th scope="row">Comments</th><td>{stats.activity.comments}</td></tr>
              <tr><th scope="row">Organisation templates</th><td>{stats.activity.templates}</td></tr>
            </tbody>
          </table>
        </>
      )}

      <h2>Classification markings</h2>
      {cfg && (
        <>
          <p>List the markings from lowest to highest. Markings with the same level count as equivalent, for example OFFICIAL: Sensitive under the PSPF and SENSITIVE under the QGISCF. The marking used for new boards is the default.</p>
          <table>
            <caption>Table 2. Markings</caption>
            <thead><tr><th scope="col">Key</th><th scope="col">Label</th><th scope="col">Level</th><th scope="col">Colour</th><th scope="col">Default</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>
              {cfg.list.map((m, i) => (
                <tr key={i}>
                  <td><input aria-label={`Key of marking ${i + 1}`} value={m.key} onChange={(e) => edit(i, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} style={{ width: 150 }} /></td>
                  <td><input aria-label={`Label of ${m.key}`} value={m.label} onChange={(e) => edit(i, { label: e.target.value })} /></td>
                  <td><input aria-label={`Level of ${m.key}`} type="number" min={0} max={20} value={m.level} onChange={(e) => edit(i, { level: Number(e.target.value) })} style={{ width: 56 }} /></td>
                  <td><input aria-label={`Colour of ${m.key}`} type="color" value={m.colour} onChange={(e) => edit(i, { colour: e.target.value })} /></td>
                  <td><input aria-label={`Use ${m.key} for new boards`} type="radio" name="default" checked={cfg.default === m.key} onChange={() => setCfg({ ...cfg, default: m.key })} /></td>
                  <td><button onClick={() => setCfg({ ...cfg, list: cfg.list.filter((_, j) => j !== i) })} disabled={cfg.list.length === 1}>Remove {m.key}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <button onClick={() => setCfg({ ...cfg, list: [...cfg.list, { key: `MARKING_${cfg.list.length + 1}`, label: "New marking", level: cfg.list.length, colour: "#1565c0" }] })}>Add a marking</button>{" "}
            <button onClick={save}>Save markings</button>
          </p>
          <p role="status">{message}</p>
        </>
      )}
      <h2>Markers and caveats</h2>
      {markers && (
        <>
          <p>If your agency uses information management markers or caveats, list them here. Owners then choose them for each board, and they follow the classification in banners and exports. Leave the list empty if you don't use them.</p>
          <table>
            <caption>Table 3. Markers and caveats</caption>
            <thead><tr><th scope="col">Key</th><th scope="col">Label</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>
              {markers.map((m, i) => (
                <tr key={i}>
                  <td><input aria-label={`Key of marker ${i + 1}`} value={m.key} onChange={(e) => setMarkers(markers.map((x, j) => (j === i ? { ...x, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") } : x)))} style={{ width: 150 }} /></td>
                  <td><input aria-label={`Label of marker ${m.key}`} value={m.label} onChange={(e) => setMarkers(markers.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></td>
                  <td><button onClick={() => setMarkers(markers.filter((_, j) => j !== i))}>Remove {m.key || "marker"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <button onClick={() => setMarkers([...markers, { key: `MARKER_${markers.length + 1}`, label: "New marker" }])}>Add a marker</button>{" "}
            <button onClick={async () => {
              setMarkerMessage("");
              try { setMarkers(await api.saveMarkerList(markers)); setMarkerMessage("Saved."); }
              catch { setMarkerMessage("The markers weren't saved. Check that each key is unique and that no marker still on a board was removed."); }
            }}>Save markers</button>
          </p>
          <p role="status">{markerMessage}</p>
        </>
      )}
      {cfg && <MigrationImport markings={cfg.list} fallback={cfg.default} />}
    </main>
  );
}
