/** A page that holds one JPEG image. `width` and `height` are the page size in CSS pixels, and the image can have more pixels. */
export interface PdfPage { jpeg: Uint8Array; width: number; height: number }

/** Reads a JPEG's size in pixels from its start-of-frame marker. Returns undefined when the bytes aren't a JPEG. */
export function jpegSize(b: Uint8Array): { width: number; height: number } | undefined {
  if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1]!;
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    // Start-of-frame markers, except the ones that aren't frame headers (DHT, JPG, DAC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]! };
    }
    i += 2 + len;
  }
  return undefined;
}

const enc = new TextEncoder();
const ascii = (s: string) => enc.encode(s);

/** PDF text strings hold ASCII as-is. Anything else goes out as UTF-16BE in hex. */
function pdfString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, (c) => "\\" + c)})`;
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  return `<${hex}>`;
}

/**
 * Builds a PDF with one page per image (EXP-2). It needs no library: each page draws one JPEG at its natural size.
 * The pages carry the classification banners, because the images come from the marked SVG export (PMK-4).
 * The title and classification also go in the document properties.
 */
export function buildPdf(pages: PdfPage[], meta: { title: string; classification: string }): Uint8Array {
  if (!pages.length) throw new Error("A PDF needs at least one page.");
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Uint8Array) => { chunks.push(b); length += b.length; };
  const obj = (n: number, ...body: (string | Uint8Array)[]) => {
    offsets[n] = length;
    push(ascii(`${n} 0 obj\n`));
    for (const part of body) push(typeof part === "string" ? ascii(part) : part);
    push(ascii("\nendobj\n"));
  };

  // Object numbers: 1 catalogue, 2 page tree, 3 info, then three per page (page, content, image).
  const first = (i: number) => 4 + i * 3;
  // The second line holds bytes above 127, so tools treat the file as binary.
  push(new Uint8Array([...ascii("%PDF-1.4\n%"), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${first(i)} 0 R`).join(" ")}] >>`);
  obj(3, `<< /Title ${pdfString(meta.title)} /Subject ${pdfString(meta.classification)} /Producer (Miroclone) >>`);
  pages.forEach((p, i) => {
    // 0.75 converts CSS pixels to PDF points.
    const w = +(p.width * 0.75).toFixed(2), h = +(p.height * 0.75).toFixed(2);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    // The image dictionary needs the image's own pixel size, which can differ from the page size.
    const px = jpegSize(p.jpeg) ?? { width: p.width, height: p.height };
    obj(first(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${first(i) + 2} 0 R >> >> /Contents ${first(i) + 1} 0 R >>`);
    obj(first(i) + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    obj(first(i) + 2,
      `<< /Type /XObject /Subtype /Image /Width ${px.width} /Height ${px.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg, "\nendstream");
  });

  const count = 4 + pages.length * 3;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(ascii(`${table}trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`));

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
