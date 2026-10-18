// Reads the text of a Word .docx (a zip of XML files) with no dependencies, so every AI tool can
// read the student's draft: headings become "#", list items "-", table rows "a | b".
import { inflateRawSync } from "node:zlib";

/** One file from a zip, or null (not a zip, not there, or packed in a way we don't read). */
export function unzipEntry(buf: Buffer, name: string): Buffer | null {
  try {
    let end = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    if (end < 0) return null;
    let p = buf.readUInt32LE(end + 16);
    for (let k = buf.readUInt16LE(end + 10); k > 0; k--) {
      if (buf.readUInt32LE(p) !== 0x02014b50) return null;
      const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28);
      const skip = 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
      if (buf.toString("utf8", p + 46, p + 46 + nlen) === name) {
        const off = buf.readUInt32LE(p + 42);
        const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
        const data = buf.subarray(start, start + size);
        return method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
      }
      p += skip;
    }
  } catch { /* a broken file */ }
  return null;
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));

/** Is this buffer a Word document? */
export const isDocx = (buf: Buffer) => buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50 && !!unzipEntry(buf, "word/document.xml");

/** The document's text as light Markdown, or null if it isn't a .docx. */
export function docxText(buf: Buffer): string | null {
  const xml = unzipEntry(buf, "word/document.xml")?.toString("utf8");
  if (!xml) return null;
  const out: string[] = [];
  let line = "", prefix = "", table = 0;
  const re = /<w:tbl>|<\/w:tbl>|<w:p[ >]|<w:p\/>|<\/w:p>|<w:pStyle w:val="([^"]+)"|<w:numPr>|<[wm]:t(?: [^>]*)?>([^<]*)<\/[wm]:t>|<w:tab\/>|<w:br[^>]*\/>|<\/w:tc>|<\/w:tr>/g;
  for (const m of xml.matchAll(re)) {
    const t = m[0];
    if (t === "<w:tbl>") table++;
    else if (t === "</w:tbl>") { table = Math.max(0, table - 1); out.push(""); }
    else if (t.startsWith("<w:p") && !t.startsWith("<w:pS")) { if (!table) { line = ""; prefix = ""; } if (t === "<w:p/>" && !table) out.push(""); }
    else if (m[1] !== undefined) { const h = m[1].match(/^(?:Heading|Title)(\d?)$/i); if (h && !table) prefix = `${"#".repeat(Number(h[1] || 1))} `; }
    else if (t === "<w:numPr>") { if (!table && !prefix) prefix = "- "; }
    else if (m[2] !== undefined) line += decode(m[2]);
    else if (t === "<w:tab/>") line += "\t";
    else if (t.startsWith("<w:br")) line += "\n";
    else if (t === "</w:p>") { if (table) line += " "; else { out.push(line.trim() ? prefix + line.trim() : ""); line = ""; } }
    else if (t === "</w:tc>") line = `${line.trimEnd()} | `;
    else if (t === "</w:tr>") { out.push(`| ${line.trim().replace(/\|$/, "").trim()} |`); line = ""; }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const wordCount = (text: unknown) => (String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
