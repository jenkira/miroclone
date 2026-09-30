import type { ReactNode } from "react";

const TOKEN = /@\[([^\]]{1,100})\]\(([^)]{1,100})\)/g;

/** Shows a comment body with mentions in bold. The text goes in as text, never as HTML. */
export function renderBody(body: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    if (m.index! > last) out.push(body.slice(last, m.index));
    out.push(<strong key={m.index}>@{m[1]}</strong>);
    last = m.index! + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

/** Finds the `@query` being typed just before the caret, if any. */
export function activeMention(text: string, caret: number): { start: number; query: string } | undefined {
  const m = /(?:^|\s)@([^\s@[\]()]{0,30})$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[1]!.length - 1, query: m[1]! } : undefined;
}

/** Replaces the `@query` with a mention token. */
export function insertMention(text: string, at: { start: number; query: string }, person: { id: string; name: string }): { text: string; caret: number } {
  const token = `@[${person.name.replace(/[\]()]/g, "")}](${person.id}) `;
  const end = at.start + 1 + at.query.length;
  return { text: text.slice(0, at.start) + token + text.slice(end), caret: at.start + token.length };
}
