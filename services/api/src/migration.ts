import { createHash, randomUUID } from "node:crypto";
import * as Y from "yjs";
import { boardFileSchema, findClassification, OBJECTS_MAP, type BoardObject, type Classification } from "@miroclone/shared";
import { appendUpdate, type Db, type ObjectStore } from "@miroclone/server-core";
import { detectImageType, MAX_UPLOAD_BYTES, svgProblem } from "./files.js";
import type { Scanner } from "./scanner.js";
import { Invalid, upsertUser } from "./boards.js";

export class Conflict extends Error {}

export interface MigrationRequest {
  /** The text of board.json from the migration tool. */
  board: string;
  classification: string;
  /** Matched to a person in Entra ID. Without a match, the importing administrator owns the board. */
  ownerEmail?: string;
  /** The Miro board ID, used to refuse a second import of the same board. */
  sourceId?: string;
  /** Image files from the board's folder, by the name board.json uses. Bytes are base64. */
  files?: { name: string; data: string }[];
}

export interface MigrationResult {
  id: string;
  ownerId: string;
  ownerResolved: boolean;
  objects: number;
  images: number;
  /** Images that couldn't be kept. Each one is now a placeholder on the board. */
  imageProblems: { name: string; reason: string }[];
}

export interface MigrationDeps {
  db: Db;
  tenantId: string;
  classifications: readonly Classification[];
  store?: ObjectStore;
  scanner?: Scanner;
  /** Looks a person up by exact email in Entra ID. Returns undefined when there's no match or no directory access. */
  findByEmail: (email: string) => Promise<{ id: string; name: string; email?: string } | undefined>;
}

/**
 * Imports one converted board for an administrator (MIG-5): assigns the owner by email, sets the classification,
 * and stores the images through the same checks as a normal upload. An image that fails a check becomes a placeholder,
 * so nothing unscanned or unsafe is stored.
 */
export async function importMigratedBoard(d: MigrationDeps, adminId: string, req: MigrationRequest): Promise<MigrationResult> {
  findClassification(req.classification, d.classifications); // Throws on an unknown marking.
  let raw: unknown;
  try { raw = JSON.parse(req.board); } catch { throw new Invalid("The board file isn't valid JSON."); }
  if (raw && typeof raw === "object") (raw as { classification?: string }).classification = req.classification;
  const parsed = boardFileSchema.safeParse(raw);
  if (!parsed.success) throw new Invalid(`The file isn't a Miroclone board: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`.trim());
  const file = parsed.data;

  const sourceRef = req.sourceId ? `miro:${req.sourceId}` : null;
  if (sourceRef) {
    const dup = await d.db.query("SELECT 1 FROM boards WHERE source_ref = $1 AND deleted_at IS NULL", [sourceRef]);
    if (dup.rows.length) throw new Conflict("This Miro board has already been imported.");
  }

  // Find the owner. A person who hasn't signed in yet gets a user record from Entra ID, so the board is theirs on first sign-in.
  let ownerId = adminId, ownerResolved = false;
  const email = req.ownerEmail?.trim();
  if (email) {
    const known = await d.db.query<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 2", [email]);
    if (known.rows.length === 1) { ownerId = known.rows[0]!.id; ownerResolved = true; }
    else if (known.rows.length === 0) {
      const found = await d.findByEmail(email).catch(() => undefined);
      if (found) { await upsertUser(d.db, { id: found.id, tenantId: d.tenantId, name: found.name, email: found.email ?? email }); ownerId = found.id; ownerResolved = true; }
    }
  }

  const id = (await d.db.query<{ id: string }>(
    "INSERT INTO boards (title, classification, created_by, source_ref) VALUES ($1, $2, $3, $4) RETURNING id",
    [file.title.trim() || "Untitled board", req.classification, ownerId, sourceRef])).rows[0]!.id;
  await d.db.query("INSERT INTO board_members (board_id, principal_type, principal_id, role) VALUES ($1, 'user', $2, 'owner')", [id, ownerId]);

  // Images: store each file once, through the upload checks, and point the objects at the stored file.
  const byName = new Map((req.files ?? []).map((f) => [f.name, f.data]));
  const stored = new Map<string, { id: string; mimeType: string } | { problem: string }>();
  const storeFile = async (name: string): Promise<{ id: string; mimeType: string } | { problem: string }> => {
    const b64 = byName.get(name);
    if (b64 === undefined) return { problem: "The file is missing from the folder." };
    if (!d.store || !d.scanner) return { problem: "Uploads are unavailable, so the image wasn't stored." };
    const bytes = new Uint8Array(Buffer.from(b64, "base64"));
    if (!bytes.length) return { problem: "The file is empty." };
    if (bytes.length > MAX_UPLOAD_BYTES) return { problem: "The file is larger than 25 MB." };
    const type = detectImageType(bytes);
    if (!type) return { problem: "The file isn't a supported image." };
    if (type === "image/svg+xml") { const why = svgProblem(bytes); if (why) return { problem: `The SVG isn't allowed: ${why}.` }; }
    let scan;
    try { scan = await d.scanner.scan(bytes); } catch { return { problem: "The malware scan was unavailable." }; }
    if (!scan.clean) return { problem: "The malware scan found a problem." };
    const fileId = randomUUID(), key = `boards/${id}/${fileId}`;
    await d.store.put(key, bytes, type);
    await d.db.query(
      "INSERT INTO board_files (id, board_id, object_key, mime_type, size_bytes, sha256, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [fileId, id, key, type, bytes.length, createHash("sha256").update(bytes).digest("hex"), adminId]);
    return { id: fileId, mimeType: type };
  };

  const imageProblems: MigrationResult["imageProblems"] = [];
  let images = 0;
  const objects: BoardObject[] = [];
  for (const o of file.objects) {
    if (o.type !== "image") { objects.push(o); continue; }
    const name = o.objectKey.replace(/^file:/, "");
    let r = stored.get(name);
    if (!r) { r = await storeFile(name); stored.set(name, r); if ("problem" in r) imageProblems.push({ name, reason: r.problem }); }
    if ("problem" in r) {
      objects.push({ id: o.id, type: "sticky", x: o.x, y: o.y, width: Math.max(o.width, 120), height: Math.max(o.height, 80), rotation: o.rotation, index: o.index, locked: false, color: "#e0e0e0", text: `Image not imported: ${r.problem}` });
    } else { images++; objects.push({ ...o, objectKey: r.id, mimeType: r.mimeType as typeof o.mimeType }); }
  }

  const doc = new Y.Doc();
  doc.transact(() => { for (const o of objects) doc.getMap(OBJECTS_MAP).set(o.id, o); });
  await appendUpdate(d.db, id, Y.encodeStateAsUpdate(doc));
  return { id, ownerId, ownerResolved, objects: objects.length, images, imageProblems };
}
