#!/usr/bin/env node
import { MiroClient } from "./client.js";
import { exportBoards } from "./export.js";

const USAGE = `Usage: miro-migrate export --out <folder> [--board <id>]... [--team <id>] [--all] [--token-env <name>] [--api-base <url>]

Reads boards through the Miro REST API and writes a folder for each board, plus manifest.json.
The access token comes from an environment variable (MIRO_TOKEN by default), never from the command line.

  --out <folder>      Where to write the output. Required.
  --board <id>        A board to export. Repeat the option for more boards.
  --all               Export every board the token can read.
  --team <id>         With --all, limit the export to one team.
  --token-env <name>  The environment variable that holds the token. Default: MIRO_TOKEN.
  --api-base <url>    The Miro API address, for a proxy. Default: https://api.miro.com.`;

export function parseArgs(argv: string[]): { out: string; boards: string[]; all: boolean; team?: string; tokenEnv: string; apiBase: string } | { error: string } {
  const [cmd, ...rest] = argv;
  if (cmd !== "export") return { error: cmd ? `Unknown command "${cmd}".` : "Choose a command." };
  const o = { out: "", boards: [] as string[], all: false, team: undefined as string | undefined, tokenEnv: "MIRO_TOKEN", apiBase: "https://api.miro.com" };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!, v = () => rest[++i];
    if (a === "--out") o.out = v() ?? "";
    else if (a === "--board") { const b = v(); if (b) o.boards.push(b); }
    else if (a === "--all") o.all = true;
    else if (a === "--team") o.team = v();
    else if (a === "--token-env") o.tokenEnv = v() ?? "";
    else if (a === "--api-base") o.apiBase = (v() ?? "").replace(/\/+$/, "");
    else if (a === "--token") return { error: "Don't pass the token on the command line, because other users can see it. Set it in an environment variable instead." };
    else return { error: `Unknown option "${a}".` };
  }
  if (!o.out) return { error: "--out is required." };
  if (!o.all && !o.boards.length) return { error: "Choose boards with --board, or use --all." };
  if (o.all && o.boards.length) return { error: "Use either --all or --board, not both." };
  if (o.team && !o.all) return { error: "--team needs --all." };
  return o;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if ("error" in args) { console.error(`${args.error}\n\n${USAGE}`); process.exit(2); }
  const token = process.env[args.tokenEnv];
  if (!token) { console.error(`Set the ${args.tokenEnv} environment variable to a Miro access token with read access.`); process.exit(2); }
  const client = new MiroClient(token, fetch, args.apiBase);
  const ids = args.all ? (await client.listBoards(args.team)).map((b) => b.id) : args.boards;
  const manifest = await exportBoards(client, ids, args.out, (l) => console.log(l));
  const failed = manifest.boards.filter((b) => b.error).length;
  console.log(`\nExported ${manifest.boards.length - failed} of ${manifest.boards.length} boards to ${args.out}.`);
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error((e as Error).message); process.exit(1); });
