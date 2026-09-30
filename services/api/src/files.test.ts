import { describe, expect, it } from "vitest";
import { detectImageType, svgProblem } from "./files.js";

const bytes = (...n: number[]) => Uint8Array.from(n);
const text = (s: string) => new TextEncoder().encode(s);

describe("detectImageType", () => {
  it("recognises each type from its first bytes", () => {
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectImageType(text("GIF89a...."))).toBe("image/gif");
    expect(detectImageType(text("GIF87a...."))).toBe("image/gif");
    expect(detectImageType(Buffer.concat([text("RIFF"), bytes(0, 0, 0, 0), text("WEBPVP8 ")]))).toBe("image/webp");
    expect(detectImageType(text('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("image/svg+xml");
    expect(detectImageType(text("  <svg/>"))).toBe("image/svg+xml");
  });
  it("rejects other content, whatever it claims to be", () => {
    expect(detectImageType(text("<html><script>alert(1)</script>"))).toBeUndefined();
    expect(detectImageType(text("MZ\x90\x00 an executable"))).toBeUndefined();
    expect(detectImageType(text("RIFF....WAVEfmt "))).toBeUndefined();
    expect(detectImageType(bytes())).toBeUndefined();
  });
});

describe("svgProblem", () => {
  const svg = (inner: string) => text(`<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`);
  it("accepts plain drawing content", () => {
    expect(svgProblem(svg('<rect width="10" height="10" fill="red"/><circle r="3"/>'))).toBeUndefined();
    expect(svgProblem(svg('<use href="#a"/><image href="data:image/png;base64,AAAA"/>'))).toBeUndefined();
  });
  it.each([
    ["<script>alert(1)</script>", "script"],
    ['<rect onclick="x()"/>', "event handler"],
    ['<a href="javascript:alert(1)"><rect/></a>', "javascript: URL"],
    ["<foreignObject><div/></foreignObject>", "foreignObject"],
    ['<image href="https://evil.test/x.png"/>', "external reference"],
    ['<use xlink:href="http://evil.test/a.svg#b"/>', "external reference"],
    ['<image href="data:image/svg+xml;base64,AAAA"/>', "external reference"],
    ["<style>@import url(https://evil.test/a.css);</style>", "external style reference"],
    ["<rect style=\"fill:url(https://evil.test/p)\"/>", "external style reference"],
    ['<!DOCTYPE svg [<!ENTITY x "y">]><rect/>', "entity declaration"],
  ])("refuses %s", (inner, why) => {
    expect(svgProblem(svg(inner))).toBe(why);
  });
});
