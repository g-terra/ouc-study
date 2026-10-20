/**
 * Visual-markdown parser. A note body is ordinary Markdown plus:
 *   ## Heading               → numbered section (also used for the table of contents)
 *   > [!IDEA] Title          → callout (IDEA, KEY, TIP, WARN, EXAM, ANALOGY, LINK)
 *   ```cards / formula / compare / steps / flashcards / terms / links / mermaid
 * See docs/NOTE_FORMAT.md.
 */
import YAML from "yaml";
import { parseBlock } from "@ouc/content/yaml-blocks";

export type Block =
  | { type: "md"; text: string }
  | { type: "h2"; text: string; id: string; n: number }
  | { type: "callout"; kind: string; title: string; text: string }
  | { type: "mermaid"; code: string }
  | { type: "data"; kind: string; data: any; raw: string };

export const DATA_BLOCKS = new Set(["cards", "formula", "compare", "steps", "flashcards", "terms", "links"]);

/** A line that carries on the paragraph above it, rather than starting a new block. */
const lazy = (line: string) => line.trim() !== "" && !/^(#{1,6}\s|```|---\s*$|\s*([-*+]|\d+[.)])\s)/.test(line);

const idOf = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-");

export function parseNote(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let buf: string[] = [];
  let n = 0;
  const flush = () => {
    const t = buf.join("\n").trim();
    if (t) out.push({ type: "md", text: t });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```\s*([\w-]+)\s*$/);
    if (fence && (DATA_BLOCKS.has(fence[1]) || fence[1] === "mermaid")) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      const raw = body.join("\n");
      if (fence[1] === "mermaid") out.push({ type: "mermaid", code: raw });
      else {
        let data: any;
        try { data = parseBlock(YAML, raw); } catch (e) { data = { error: String(e) }; }
        out.push({ type: "data", kind: fence[1], data, raw });
      }
      continue;
    }
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      flush();
      out.push({ type: "h2", text: h2[1], id: idOf(h2[1]), n: ++n });
      continue;
    }
    const call = line.match(/^>\s*\[!(\w+)\]\s*(.*)$/);
    if (call) {
      flush();
      const body: string[] = [];
      // CommonMark "lazy continuation": a line right after the callout without its ">" still belongs to it (until a blank line)
      for (i++; i < lines.length && (/^>/.test(lines[i]) || lazy(lines[i])) && !/^>\s*\[!\w+\]/.test(lines[i]); i++) body.push(lines[i].replace(/^>\s?/, ""));
      i--;
      out.push({ type: "callout", kind: call[1].toUpperCase(), title: call[2], text: body.join("\n") });
      continue;
    }
    buf.push(line);
  }
  flush();
  return out;
}
