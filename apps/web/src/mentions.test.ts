import { describe, expect, it } from "vitest";
import { activeMention, insertMention } from "./mentions.js";

describe("mention typing", () => {
  it("finds the query being typed", () => {
    expect(activeMention("hello @An", 9)).toEqual({ start: 6, query: "An" });
    expect(activeMention("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMention("a@b", 3)).toBeUndefined();
    expect(activeMention("hello @An rest", 9)).toEqual({ start: 6, query: "An" });
    expect(activeMention("done @[Ann](u1) ", 16)).toBeUndefined();
  });
  it("replaces the query with a token and moves the caret after it", () => {
    const at = activeMention("hi @An", 6)!;
    const r = insertMention("hi @An", at, { id: "u1", name: "Ann Author" });
    expect(r.text).toBe("hi @[Ann Author](u1) ");
    expect(r.caret).toBe(r.text.length);
  });
  it("strips characters that would break the token from a name", () => {
    expect(insertMention("@", { start: 0, query: "" }, { id: "u", name: "A](x)B" }).text).toBe("@[AxB](u) ");
  });
});
