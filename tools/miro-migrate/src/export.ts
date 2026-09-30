import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exportJson } from "@miroclone/shared";
import { convertBoard, type ImageResult } from "./convert.js";
import { MiroClient } from "./client.js";
import { detectImage, extensionFor, MAX_IMAGE_BYTES } from "./images.js";
import { buildReport, reportMarkdown, type BoardReport } from "./report.js";
import type { MiroBoard } from "./miro-types.js";

export interface ManifestEntry {
  folder: string;
  miroBoardId: string;
  title: string;
  ownerName?: string;
  /** Present when Miro returns it. Otherwise the administrator supplies owners at import (MIG-5). */
  ownerEmail?: string;
  objects: number;
  totals: BoardReport["totals"];
  error?: string;
}

export interface Manifest { format: "miroclone-migration"; version: 1; exportedAt: string; boards: ManifestEntry[] }

const slug = (s: string) => s.normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "board";

/** Downloads each image item's file, checking its type by content and its size. */
async function fetchImages(client: MiroClient, miro: MiroBoard): Promise<{ results: Record<string, ImageResult>; files: { name: string; bytes: Uint8Array }[] }> {
  const results: Record<string, ImageResult> = {};
  const files: { name: string; bytes: Uint8Array }[] = [];
  for (const item of miro.items.filter((i) => i.type === "image")) {
    try {
      const bytes = await client.image(miro.info.id, item.id);
      if (bytes.length > MAX_IMAGE_BYTES) { results[item.id] = { error: "the file is larger than 25 MB" }; continue; }
      const mimeType = detectImage(bytes);
      if (!mimeType) { results[item.id] = { error: "the file isn't a PNG, JPEG, GIF, WebP, or SVG image" }; continue; }
      const name = `files/${item.id.replace(/[^\w-]/g, "_")}.${extensionFor(mimeType)}`;
      files.push({ name, bytes });
      results[item.id] = { fileName: name, mimeType };
    } catch (err) {
      results[item.id] = { error: (err as Error).message };
    }
  }
  return { results, files };
}

/** Converts a board already read from Miro, and writes its folder: board.json, report.json, report.md, and files. */
export async function writeBoard(out: string, miro: MiroBoard, images: { results: Record<string, ImageResult>; files: { name: string; bytes: Uint8Array }[] }, now = new Date()): Promise<ManifestEntry> {
  const conversion = convertBoard(miro, { images: images.results });
  const report = buildReport(miro.info.id, conversion, now);
  const folder = `${slug(conversion.title)}-${slug(miro.info.id)}`;
  const dir = join(out, folder);
  await mkdir(join(dir, "files"), { recursive: true });
  const used = new Set(conversion.objects.filter((o) => o.type === "image").map((o) => (o as { objectKey: string }).objectKey.replace(/^file:/, "")));
  for (const f of images.files) if (used.has(f.name)) await writeFile(join(dir, f.name), f.bytes);
  // The classification is a starting value. The administrator sets the real one when importing (MIG-5).
  await writeFile(join(dir, "board.json"), exportJson(conversion.objects, { title: conversion.title, classification: "OFFICIAL" }));
  await writeFile(join(dir, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(dir, "report.md"), reportMarkdown(report));
  const owner = miro.info.owner;
  const ownerEmail = owner?.email ?? miro.members.find((m) => m.id === owner?.id)?.email;
  return { folder, miroBoardId: miro.info.id, title: conversion.title, ownerName: owner?.name, ownerEmail, objects: conversion.objects.length, totals: report.totals };
}

/**
 * Exports boards from Miro into `out` (MIG-1, MIG-4). A board that fails doesn't stop the others,
 * and its error goes in the manifest. Returns the manifest.
 */
export async function exportBoards(client: MiroClient, ids: string[], out: string, log: (line: string) => void = () => {}, now = new Date()): Promise<Manifest> {
  await mkdir(out, { recursive: true });
  const boards: ManifestEntry[] = [];
  for (const id of ids) {
    try {
      log(`Reading board ${id}`);
      const miro = await client.board(id);
      const entry = await writeBoard(out, miro, await fetchImages(client, miro), now);
      log(`  ${entry.title}: ${entry.objects} objects, ${entry.totals.placeholder} placeholders, ${entry.totals.error} errors`);
      boards.push(entry);
    } catch (err) {
      log(`  Failed: ${(err as Error).message}`);
      boards.push({ folder: "", miroBoardId: id, title: id, objects: 0, totals: { items: 0, converted: 0, approximated: 0, placeholder: 0, error: 0 }, error: (err as Error).message });
    }
  }
  const manifest: Manifest = { format: "miroclone-migration", version: 1, exportedAt: now.toISOString(), boards };
  await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}
