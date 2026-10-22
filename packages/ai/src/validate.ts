/**
 * Checks a visual note or a prep pack (PREP.md) against docs/NOTE_FORMAT.md, a quiz (quizzes/<CODE>/<name>.json)
 * against docs/QUIZ_FORMAT.md, and homework (homework/tasks.json, homework/check.json) against docs/HOMEWORK_FORMAT.md,
 * so any AI (or person) can verify its work.
 *   node packages/ai/validate.mjs <note.md | quiz.json | homework/tasks.json | homework/check.json> [...]   exit 1 if there are errors
 *   node packages/ai/validate.mjs --all               every note, prep pack and quiz in every semester
 *   --fix                                             also rewrite LaTeX in double quotes as single-quoted, in place
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { hasQuotedLatex, parseBlock, singleQuoteLatex } from "../../content/src/yaml-blocks.ts";
import { parseQuiz } from "../../content/src/quiz.ts";
import { parseCheck, parseHomework } from "../../content/src/homework.ts";

const CALLOUTS = new Set(["IDEA", "KEY", "TIP", "WARN", "EXAM", "ANALOGY", "LINK"]);
const DATA = new Set(["cards", "formula", "compare", "steps", "flashcards", "terms", "links"]);
const MERMAID_START = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|mindmap|timeline|pie|quadrantChart|journey|gantt|xychart-beta|block-beta)\b/;
/** A parsed YAML block: any shape until each field is checked below. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Parsed = any;
const list = (d: Parsed): Parsed[] | null => (Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : null);

/** `prep: true` for a prep pack (PREP.md): same blocks, but no note front matter or note sections expected. */
export function validateNote(src: string, { prep = false } = {}): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const text = src.replace(/\r\n/g, "\n");
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (prep) { /* its front matter (by, updated, log) is the app's */ }
  else if (!fm) errors.push("Missing front matter (--- … --- at the very top).");
  else {
    const f: Record<string, string> = {};
    for (const l of fm[1].split("\n")) { const i = l.indexOf(":"); if (i > 0) f[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
    for (const k of ["course", "section", "title", "summary"]) if (!f[k]) errors.push(`Front matter is missing "${k}".`);
    if (f.section && !/^-?\d+$/.test(f.section)) errors.push(`Front matter "section" must be a number (the eClass section index), got "${f.section}".`);
  }
  const body = fm ? text.slice(fm[0].length) : text;
  const lines = body.split("\n");
  const off = fm ? fm[0].split("\n").length - 1 : 0; // report line numbers of the whole file
  const seen = new Set();
  let open = null, start = 0, buf = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (open === null) {
      const m = l.match(/^```\s*([\w-]*)\s*$/);
      if (m) { open = m[1]; start = i + 1; buf = []; continue; }
      const c = l.match(/^>\s*\[!(\w+)\]/);
      if (c && !CALLOUTS.has(c[1]!.toUpperCase())) errors.push(`Line ${i + 1 + off}: unknown callout [!${c[1]}] (use ${[...CALLOUTS].join(", ")}).`);
      continue;
    }
    if (!/^```\s*$/.test(l)) { buf.push(l); continue; }
    const kind = open, raw = buf.join("\n"), at = `Line ${start + off}: \`${kind}\` block`;
    open = null; seen.add(kind);
    if (kind === "mermaid") {
      const code = raw.trim();
      if (!MERMAID_START.test(code)) errors.push(`${at} must start with a diagram type such as "flowchart LR".`);
      const unquoted = code.replace(/"[^"\n]*"/g, '""');
      for (const m of unquoted.matchAll(/\b[\w-]+\s*(\[|\(|\{)(?!["(\[{])([^\]\)\}\n]*)(\]|\)|\})/g)) {
        if (/[()":;,<>]/.test(m[2]) || /[\[\]{}]/.test(m[2])) { errors.push(`${at}: quote this label: ${m[0].trim()} → use A["…"].`); break; }
      }
      continue;
    }
    if (!DATA.has(kind)) continue;
    if (hasQuotedLatex(raw)) errors.push(`${at} has LaTeX in "double quotes", where YAML reads \\ as an escape (\\tau becomes a tab). Use 'single quotes' or a | block (--fix does it).`);
    let d: Parsed;
    try { d = parseBlock(YAML, raw); } catch (e) { errors.push(`${at} is not valid YAML: ${String((e as Error).message).split("\n")[0]}`); continue; }
    const need = (cond: unknown, msg: string) => { if (!cond) errors.push(`${at}: ${msg}`); };
    switch (kind) {
      case "cards": { const a = list(d); need(a && a.length, "needs a list of cards with title and text."); a?.forEach((c: Parsed, j: number) => need(c?.title && c?.text !== undefined, `card ${j + 1} needs "title" and "text".`)); break; }
      case "formula": (Array.isArray(d) ? d : [d]).forEach((f: Parsed, j: number) => {
        need(f?.tex, `${Array.isArray(d) ? `formula ${j + 1} ` : ""}needs "tex:" (LaTeX in single quotes).`);
        if (f?.where) need(Array.isArray(f.where), '"where" must be a list of [symbol, meaning] pairs.');
      }); break;
      case "compare": {
        need(Array.isArray(d?.headers), 'needs "headers: [ … ]".'); need(Array.isArray(d?.rows), 'needs "rows:" (a list of lists).');
        if (Array.isArray(d?.headers) && Array.isArray(d?.rows)) d.rows.forEach((r: Parsed, j: number) => need(Array.isArray(r) && r.length === d.headers.length, `row ${j + 1} has ${Array.isArray(r) ? r.length : 0} cells but there are ${d.headers.length} headers (quote cells that contain commas).`));
        break;
      }
      case "steps": { const a = list(d); need(a && a.length, 'needs "items:" (a list of steps with title).'); a?.forEach((s: Parsed, j: number) => need(s?.title, `step ${j + 1} needs a "title".`)); break; }
      case "terms": { const a = list(d); need(a && a.length, "needs a list of { term, def }."); a?.forEach((t: Parsed, j: number) => need(t?.term && t?.def, `term ${j + 1} needs "term" and "def".`)); break; }
      case "flashcards": { const a = list(d); need(a && a.length, "needs a list of { q, a }."); a?.forEach((t: Parsed, j: number) => need(t?.q && t?.a, `card ${j + 1} needs "q" and "a".`)); break; }
      case "links": { const a = list(d); need(a && a.length, "needs a list of { title, url }."); a?.forEach((t: Parsed, j: number) => need(t?.title && /^(https?:\/\/|\/files\/)/.test(t?.url ?? ""), `link ${j + 1} needs a "title" and a "url" (https://… or a /files/… path).`)); break; }
    }
  }
  if (open !== null) errors.push(`Line ${start + off}: a \`${open || "code"}\` block is never closed with \`\`\`.`);
  if (((body.match(/\$\$/g) ?? []).length) % 2) errors.push("Unbalanced $$ … $$ display maths.");
  if (!prep) {
    if (!/^>\s*\[!IDEA\]/m.test(body)) warnings.push("No > [!IDEA] big-idea callout.");
    for (const k of ["cards", "mermaid", "flashcards"]) if (!seen.has(k)) warnings.push(`No \`${k}\` block (the format expects one).`);
  }
  return { errors, warnings };
}

/** The file with LaTeX inside double-quoted YAML in its ``` blocks rewritten as single-quoted (nothing else changes). */
export function fixQuotedLatex(src: string): string {
  return src.replace(/^(```\s*[\w-]+[ \t]*\n)([\s\S]*?)(^```[ \t]*$)/gm, (all, open: string, body: string, close: string) => (/^```\s*mermaid/.test(open) ? all : open + singleQuoteLatex(body) + close));
}

/** A quiz file, by its path: the course code is the folder it is in. */
export function validateQuiz(src: string, file: string): { errors: string[]; warnings: string[] } {
  const parts = file.split(/[\\/]/);
  if (parts.at(-3) !== "quizzes") return { errors: ["A quiz goes in semesters/<id>/quizzes/<COURSE CODE>/<name>.json."], warnings: [] };
  const { errors, warnings } = parseQuiz(src, { code: parts.at(-2)!, name: parts.at(-1)!.replace(/\.json$/, "") });
  return { errors, warnings };
}

const HOMEWORK_FILE = /(^|[\\/])homework[\\/](tasks|check)\.json$/;

/** A homework file, by its path: a check is read against the tasks.json next to it (`sibling` reads that). */
export function validateHomework(src: string, file: string, sibling: (name: string) => string | null): { errors: string[]; warnings: string[] } {
  if (file.match(HOMEWORK_FILE)?.[2] === "tasks") return { errors: parseHomework(src).problems, warnings: [] };
  const tasks = sibling("tasks.json");
  const hw = tasks === null ? null : parseHomework(tasks).homework;
  if (!hw) return { errors: ["Check the answers against a valid homework/tasks.json next to this file."], warnings: [] };
  return { errors: parseCheck(src, hw.tasks).problems, warnings: [] };
}

// ---------- CLI ----------
/** `node packages/ai/validate.mjs` (the launcher calls this). */
export function main(argv: string[]): never {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const files = argv.filter((a) => !a.startsWith("--"));
  if (argv.includes("--all")) {
    const sems = join(ROOT, "semesters");
    for (const s of existsSync(sems) ? readdirSync(sems) : []) {
      const nd = join(sems, s, "notes");
      if (!existsSync(nd) || !statSync(nd).isDirectory()) continue;
      for (const c of readdirSync(nd)) for (const f of existsSync(join(nd, c)) && statSync(join(nd, c)).isDirectory() ? readdirSync(join(nd, c)) : []) if (f.endsWith(".md")) files.push(join(nd, c, f));
    }
    // prep packs and homework: semesters/<id>/assignments/<CODE>/<folder>/PREP.md, homework/tasks.json, homework/check.json
    for (const s of existsSync(sems) ? readdirSync(sems) : []) {
      const ad = join(sems, s, "assignments");
      if (!existsSync(ad) || !statSync(ad).isDirectory()) continue;
      for (const c of readdirSync(ad)) if (statSync(join(ad, c)).isDirectory()) for (const a of readdirSync(join(ad, c))) {
        for (const f of ["PREP.md", "homework/tasks.json", "homework/check.json"]) if (existsSync(join(ad, c, a, f))) files.push(join(ad, c, a, f));
      }
    }
    // quizzes: semesters/<id>/quizzes/<CODE>/<name>.json
    for (const s of existsSync(sems) ? readdirSync(sems) : []) {
      const qd = join(sems, s, "quizzes");
      if (!existsSync(qd) || !statSync(qd).isDirectory()) continue;
      for (const c of readdirSync(qd)) if (statSync(join(qd, c)).isDirectory()) for (const f of readdirSync(join(qd, c))) if (f.endsWith(".json")) files.push(join(qd, c, f));
    }
  }
  if (!files.length) { console.error("Usage: node packages/ai/validate.mjs <note.md | PREP.md | quiz.json | homework/tasks.json | homework/check.json> [...] | --all  [--fix]"); process.exit(2); }
  let bad = 0;
  for (const f of files) {
    const name = f.replace(`${ROOT}/`, "");
    let src = readFileSync(f, "utf8");
    if (f.endsWith(".json")) {
      const sibling = (n: string) => (existsSync(join(dirname(f), n)) ? readFileSync(join(dirname(f), n), "utf8") : null);
      const { errors, warnings } = HOMEWORK_FILE.test(f) ? validateHomework(src, f, sibling) : validateQuiz(src, resolve(f));
      if (errors.length) { bad++; console.log(`✗ ${name}`); errors.forEach((e) => console.log(`    error: ${e}`)); }
      else console.log(`✓ ${name}`);
      warnings.forEach((w) => console.log(`    note: ${w}`));
      continue;
    }
    if (argv.includes("--fix")) { const fixed = fixQuotedLatex(src); if (fixed !== src) { writeFileSync(f, fixed); src = fixed; console.log(`  fixed LaTeX quoting in ${name}`); } }
    const { errors, warnings } = validateNote(src, { prep: /(^|[\\/])PREP\.md$/.test(f) });
    if (errors.length) { bad++; console.log(`✗ ${name}`); errors.forEach((e) => console.log(`    error: ${e}`)); }
    else console.log(`✓ ${name}`);
    warnings.forEach((w) => console.log(`    note: ${w}`));
  }
  process.exit(bad ? 1 : 0);
}
