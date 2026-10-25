// Tiny PDF writer: one page per JPEG image (DCTDecode XObject), with a correct xref table.
export interface PdfPage {
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  width: number;
  height: number;
  /** Page size in points (1/72"). */
  pageWidth: number;
  pageHeight: number;
}

const enc = new TextEncoder();
const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

export function buildPdf(pages: PdfPage[], title = "Excalimade"): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const b = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(b);
    length += b.length;
  };
  // object numbers: 1 catalog, 2 pages, 3 info, then per page: page, content, image
  const nObjects = 3 + pages.length * 3;
  const pageObj = (i: number) => 4 + i * 3;
  const beginObj = (n: number) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
  };

  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker comment

  beginObj(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  beginObj(2);
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] >>\nendobj\n`);
  beginObj(3);
  const safeTitle = title.replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7e]/g, "?");
  push(`<< /Title (${safeTitle}) /Producer (Excalimade) /CreationDate (D:${pdfDate()}) >>\nendobj\n`);

  pages.forEach((p, i) => {
    const pn = pageObj(i);
    const content = `q\n${fmt(p.pageWidth)} 0 0 ${fmt(p.pageHeight)} 0 0 cm\n/Im0 Do\nQ\n`;
    beginObj(pn);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(p.pageWidth)} ${fmt(p.pageHeight)}] ` +
        `/Resources << /XObject << /Im0 ${pn + 2} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${pn + 1} 0 R >>\nendobj\n`,
    );
    beginObj(pn + 1);
    push(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);
    beginObj(pn + 2);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
    );
    push(p.jpeg);
    push("\nendstream\nendobj\n");
  });

  const xrefOffset = length;
  let xref = `xref\n0 ${nObjects + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= nObjects; n++) xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${nObjects + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function pdfDate(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Page size in points: keep the aspect ratio, longest side = `maxSide` (A4 long edge ≈ 842pt). */
export function fitPageSize(pxWidth: number, pxHeight: number, maxSide = 842) {
  const k = maxSide / Math.max(pxWidth, pxHeight, 1);
  return { pageWidth: pxWidth * k, pageHeight: pxHeight * k };
}
