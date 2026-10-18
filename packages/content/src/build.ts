/**
 * Content builder: turns every semesters/<id>/ folder into JSON for the web app.
 *
 *   semesters/<id>/semester.json        course registry (codes, names, colours, how weeks are dated, class times)
 *   semesters/<id>/_meta/*.json         eClass scrape, submissions, exams, study resources
 *   semesters/<id>/notes/<CODE>/*.md    visual notes (docs/NOTE_FORMAT.md)
 *   semesters/<id>/plans/<YYYY>-W<NN>.md week plans (ai/skills/plan-week)
 *   semesters/<id>/assignments/...      one folder per assignment (brief + my-submission/)
 *   semesters/<id>/courses/...          the downloaded course files
 *
 * Output: apps/web/public/data/index.json and apps/web/public/data/<id>.json
 * Files are not copied; the web app serves them from /files/<id>/<path>.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildClasses, detectClasses, type ClassesConfig } from "./classes.ts";
import { parsePlan } from "./plan.ts";
import type {
  UpdatesFeed, GradeItem, ClassSession,
  Assignment, Prep, Course, Exam, FileRef, Note, Resource, SemesterData, SemesterIndex, SemesterSummary, Week, WeekItem,
} from "./types.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// OUC_SEMESTERS / OUC_PUBLIC: another data folder and output, e.g. the demo semester of the smoke tests (e2e/)
const SEMESTERS = process.env.OUC_SEMESTERS ? resolve(process.env.OUC_SEMESTERS) : join(ROOT, "semesters");
const OUT = join(process.env.OUC_PUBLIC ? resolve(process.env.OUC_PUBLIC) : join(ROOT, "apps/web/public"), "data");

// ---------- config types ----------
interface CourseConfig {
  code: string;
  title: string;
  short: string;
  color: string;
  eclassId?: number;
  dir: string;                               // folder under courses/
  dating: { mode: "title" } | { mode: "weekly"; first: string; pattern: string };
  label?: "firstResource" | "stripWeek" | "lecture" | "name";
  classes?: ClassesConfig;                   // weekly live class (webconference), see classes.ts
}
interface SemesterConfig {
  id?: string;
  label: string;
  start: string;
  end: string;
  examTimetable?: string;
  timezone?: string;                         // of the class times; default Europe/Nicosia
  courses: CourseConfig[];
}

// ---------- helpers ----------
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const readJson = <T>(p: string, fallback: T): T => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback);

/** Same slug rule the folder layout was created with (mirrors the original Python importer). */
export function slug(s: string, n = 60): string {
  const cleaned = s.replace(/[^\p{L}\p{N}_\s.-]/gu, "").trim().replace(/\s+/g, "-");
  return cleaned.slice(0, n).replace(/^-+|-+$/g, "") || "section";
}
const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoLocal = (d: Date) => `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const clean = (t = "") => t.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
const fileHref = (sem: string, rel: string) => `/files/${encodeURIComponent(sem)}/${rel.split("/").map(encodeURIComponent).join("/")}`;
const extOf = (name: string) => extname(name).replace(".", "").toLowerCase();

/** "Due: Thursday, 22 October 2026, 9:59 PM" → Date */
function parseEclassDate(s?: string): Date | undefined {
  if (!s) return;
  const m = s.replace(/^(Due|Opened|Opens):\s*/, "").match(/(\d{1,2}) (\w+) (\d{4})(?:, (\d{1,2}):(\d{2}) ([AP]M))?/);
  if (!m) return;
  const mo = MONTHS.indexOf(m[2]);
  if (mo < 0) return;
  let h = m[4] ? Number(m[4]) % 12 : 0;
  if (m[6] === "PM") h += 12;
  return new Date(Number(m[3]), mo, Number(m[1]), h, m[5] ? Number(m[5]) : 0);
}
function dayMonth(txt: string, year: number): Date | undefined {
  const re1 = new RegExp(`(\\d{1,2})\\s+(${MONTHS.join("|")})`);
  const re2 = new RegExp(`(${MONTHS.join("|")})\\s+(\\d{1,2})`);
  const a = txt.match(re1);
  if (a) return new Date(year, MONTHS.indexOf(a[2]), Number(a[1]));
  const b = txt.match(re2);
  if (b) return new Date(year, MONTHS.indexOf(b[1]), Number(b[2]));
}
function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => !f.startsWith(".") && statSync(join(dir, f)).isFile());
}

// ---------- notes ----------
function parseFrontmatter(src: string): { fm: Record<string, string>; body: string } {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, body: src };
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { fm, body: src.slice(m[0].length) };
}

// ---------- main ----------
function buildSemester(id: string): SemesterData | undefined {
  const dir = join(SEMESTERS, id);
  const cfgPath = join(dir, "semester.json");
  if (!existsSync(cfgPath)) return;
  const cfg = readJson<SemesterConfig>(cfgPath, {} as SemesterConfig);
  const year = Number(cfg.start.slice(0, 4));
  const meta = readJson<any[]>(join(dir, "_meta/eclass-meta.json"), []);
  const subs = readJson<{ subs: any[] }>(join(dir, "_meta/submissions.json"), { subs: [] }).subs;
  const resources = readJson<Record<string, any>>(join(dir, "_meta/resources.json"), {});
  const examsRaw = readJson<any[]>(join(dir, "_meta/exams.json"), []);
  const subByKey = new Map(subs.map((s) => [`${s.code}|${s.name}`, s]));
  // live data from the daily API sync (packages/eclass-sync), newer than the scrape
  const live = readJson<{ updated?: string; assignments?: Record<string, any>; grades?: any[]; courses?: Record<string, { joinUrl?: string; groups?: string[]; posts?: { at?: string; text: string }[] }> }>(join(dir, "_meta/live.json"), {});

  const courses: Course[] = [];
  const assignments: Assignment[] = [];
  const notes: Note[] = [];
  const classes: ClassSession[] = [];

  for (const cc of cfg.courses) {
    const m = meta.find((x) => x.code === cc.code) ?? { secs: [] };
    const secDir = (s: any) => `courses/${cc.dir}/${pad(s.i)}-${slug(s.name)}`;
    const weeks: Week[] = [];

    for (const s of m.secs as any[]) {
      // --- dates
      let start: Date | undefined, end: Date | undefined, estimated = false;
      if (cc.dating.mode === "weekly") {
        const wm = s.name.match(new RegExp(cc.dating.pattern));
        if (wm) {
          const [y, mo, d] = cc.dating.first.split("-").map(Number);
          start = addDays(new Date(y, mo - 1, d), (Number(wm[1]) - 1) * 7);
          end = addDays(start, 6);
          estimated = true;
        }
      } else {
        const range = s.name.match(new RegExp(`(\\d{1,2}) (${MONTHS.join("|")})\\s*-\\s*(\\d{1,2}) (${MONTHS.join("|")})`));
        if (range) {
          start = new Date(year, MONTHS.indexOf(range[2]), Number(range[1]));
          end = new Date(year, MONTHS.indexOf(range[4]), Number(range[3]));
          if (end < start) end = new Date(year + 1, end.getMonth(), end.getDate());
        } else if (/^Week \d+/.test(s.name)) {
          start = dayMonth(s.name, year);
          if (start) end = addDays(start, 6);
        }
      }
      // --- items
      const items: WeekItem[] = [];
      for (const a of s.acts as any[]) {
        const title = String(a.name ?? "").trim();
        if (!title || a.type === "label") continue;
        if (a.type === "resource") {
          if (a.local) {
            const rel = `${secDir(s)}/${String(a.local).split("/").slice(2).join("/")}`;
            items.push({ kind: "file", title, href: fileHref(id, rel), ext: extOf(rel) });
          } else items.push({ kind: "link", title: `${title} (on eClass)`, href: a.url, external: true });
        } else if (a.type === "page") {
          const vid = (a.links ?? []).find((l: string) => /youtu|vimeo|panopto|video\.ouc|stream|kaltura/i.test(l));
          items.push({ kind: "video", title, href: vid ?? a.url, external: true });
        } else if (a.type === "url") {
          const target = a.target || a.url;
          items.push({ kind: /video|panopto|youtu/i.test(target) ? "video" : "link", title, href: target, external: true });
        } else if (a.type === "forum") items.push({ kind: "forum", title, href: a.url, external: true });
        else if (a.type === "assign") items.push({ kind: "assignment", title });
        else items.push({ kind: "tool", title, href: a.url, external: true });
      }
      // --- label & summary
      let summary = clean(s.summary).replace(/\s+/g, " ");
      summary = summary.replace(new RegExp(`^${cc.code} \\| WEEK \\d+ `), "");
      const stripped = s.name.replace(/^Week \d+:\s*/, "");
      if (stripped && summary.startsWith(stripped)) summary = summary.slice(stripped.length).trim();
      summary = summary.replace(/\s*(Study guide|Start with|Open the study guide).*$/i, "").trim();
      let label = s.name;
      const firstFile = items.find((x) => x.kind === "file");
      if (cc.label === "firstResource" && firstFile) label = firstFile.title.replace(/^\d+\.\s*/, "");
      else if (cc.label === "stripWeek") label = stripped;
      else if (cc.label === "lecture") {
        const lec = items.find((x) => /^Lecture \d+/i.test(x.title));
        if (lec) label = lec.title.replace(/\s*-\s*(slides|prerecording video|Fall \d+ recording)$/i, "");
        else if (s.i > 0) label = items.length ? stripped : "No lecture this week";
      }
      if (s.i === 0) label = "General";
      weeks.push({
        index: s.i, name: s.name, label, summary, items, estimated,
        start: start ? isoDate(start) : undefined, end: end ? isoDate(end) : undefined,
      });
    }

    // --- assignments
    // PREP.md: the study pack the AI prepares for an assignment (front matter written by packages/ai/src/api.ts)
    const readPrep = (abs: string): Prep | undefined => {
      if (!existsSync(abs)) return undefined;
      const text = readFileSync(abs, "utf8");
      const fm = text.match(/^---\n([\s\S]*?)\n---\n?/)?.[1] ?? "";
      const get = (k: string) => fm.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1]?.trim() || undefined;
      return { body: text.slice(fm ? text.indexOf("\n---", 3) + 4 : 0).trim(), by: get("by"), updated: get("updated"), log: [...fm.matchAll(/^\s+-\s+(.+)$/gm)].map((m) => m[1]) };
    };
    for (const s of m.secs as any[]) {
      for (const a of s.acts as any[]) {
        if (a.type !== "assign" || String(a.name).trim() === "Exams Grade") continue;
        const due = parseEclassDate((a.dates ?? []).find((d: string) => d.startsWith("Due")));
        const opened = parseEclassDate((a.dates ?? []).find((d: string) => d.startsWith("Open")));
        const sb = subByKey.get(`${cc.code}|${a.name}`) ?? {};
        const rows = sb.rows ?? {};
        const status: string = rows["Submission status"] ??
          ((a.status ?? []).find((x: string) => x.startsWith("Submission status")) ?? "").replace("Submission status ", "");
        const short = String(a.name).replace(/\s*\(due date:[^)]*\)/, "").trim();
        const folderName = due ? `${pad(due.getMonth() + 1)}-${pad(due.getDate())}_${slug(short, 45)}` : slug(short, 45);
        const folderRel = `assignments/${cc.code}/${folderName}`;
        const folderAbs = join(dir, folderRel);
        const briefs: FileRef[] = listFiles(folderAbs)
          .filter((f) => !/^(README\.md|PREP\.md|index\.html)$/i.test(f))
          .map((f) => ({ name: f, href: fileHref(id, `${folderRel}/${f}`), ext: extOf(f) }));
        const submissions: FileRef[] = listFiles(join(folderAbs, "my-submission"))
          .map((f) => ({ name: f, href: fileHref(id, `${folderRel}/my-submission/${f}`), ext: extOf(f) }));
        let question = clean(a.body);
        if (/^[\w .,()&'-]+\.(pdf|docx)\s+\d{1,2} \w+ \d{4}, \d{1,2}:\d{2} [AP]M$/.test(question.replace(/\n/g, " "))) question = "";
        let fb: string = clean(rows["Feedback comments"] ?? "");
        if (fb.length > 40 && fb.includes("...") && fb.slice(0, Math.floor(fb.length / 2)).startsWith(fb.slice(0, 30))) fb = fb.split("...").slice(1).join("...").trim();
        const r = resources[`${cc.code}|${a.name}`];
        const res: Resource | undefined = r && {
          focus: r.focus ?? "",
          local: (r.local ?? []).map(([t, p]: [string, string]) => ({ title: t, href: fileHref(id, p) })),
          links: (r.links ?? []).map(([t, u, k, w]: string[]) => ({ title: t, url: u, kind: k, why: w })),
        };
        const aid = `${cc.code}/${folderName}`;
        const cmid = String(a.url ?? "").match(/[?&]id=(\d+)/)?.[1];
        const lv = cmid ? live.assignments?.[cmid] : undefined;
        assignments.push({
          id: aid, code: cc.code, title: short, fullTitle: a.name,
          due: lv?.due ?? (due ? isoLocal(due) : undefined), opened: lv?.opened ?? (opened ? isoLocal(opened) : undefined),
          status: lv?.status ? ({ submitted: "Submitted for grading", draft: "Draft (not submitted)", new: "No submissions have been made yet" } as Record<string, string>)[lv.status] ?? lv.status : status,
          submitted: lv?.status ? lv.status === "submitted" : /Submitted/i.test(status),
          grade: lv?.grade || rows["Grade"] || undefined, feedback: lv?.feedback || fb || undefined,
          question, weekIndex: s.i, eclassUrl: a.url, briefs, submissions, resources: res,
          workingNotes: existsSync(join(folderAbs, "README.md")) ? fileHref(id, `${folderRel}/README.md`) : undefined,
          prep: readPrep(join(folderAbs, "PREP.md")),
        });
        const w = weeks.find((x) => x.index === s.i);
        const it = w?.items.find((x) => x.kind === "assignment" && x.title === String(a.name).trim());
        if (it) it.assignmentId = aid;
      }
    }

    // --- notes
    const nd = join(dir, "notes", cc.code);
    for (const f of listFiles(nd).filter((f) => f.endsWith(".md")).sort()) {
      const { fm, body } = parseFrontmatter(readFileSync(join(nd, f), "utf8"));
      const slugName = f.replace(/\.md$/, "");
      const note: Note = {
        code: cc.code, slug: slugName, title: fm.title ?? slugName, summary: fm.summary ?? "",
        week: Number(fm.week ?? 0), weekIndex: Number(fm.section ?? -1),
        tags: (fm.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
        source: fm.source ? { name: fm.source.split("/").pop()!, href: fileHref(id, fm.source), ext: extOf(fm.source) } : undefined,
        body,
      };
      notes.push(note);
      const w = weeks.find((x) => x.index === note.weekIndex);
      w?.items.unshift({ kind: "note", title: note.title, noteSlug: note.slug });
      // "Lecture 5" alone says little: borrow the note's topic for the week label.
      if (w && /^Lecture \d+$/.test(w.label) && note.title.includes("·")) w.label = `${w.label} · ${note.title.split("·").pop()!.trim()}`;
    }

    const grades: GradeItem[] = (live.grades ?? []).filter((g) => g.code === cc.code && g.grade)
      .map((g) => ({ item: g.item, grade: g.grade, feedback: g.feedback || undefined, graded: g.graded }));
    // --- live classes: the Webconference activity on the course page is the join link
    const conf = (m.secs as any[]).flatMap((s) => s.acts as any[]).find((a) => a.type === "lti" && /web\s*-?\s*confer|τηλεσυν/i.test(a.name ?? ""));
    const joinUrl: string | undefined = cc.classes?.joinUrl || live.courses?.[cc.code]?.joinUrl || conf?.url || undefined;
    // the weekly slot: read from eClass (Webconference description, tutors' posts); semester.json overrides
    const livePosts = live.courses?.[cc.code]?.posts ?? [];
    const found = detectClasses({ secs: [...m.secs, { acts: [{ type: "forum", threads: [{ posts: livePosts }] }] }] });
    const slot: ClassesConfig | undefined = cc.classes || found
      ? { ...found, ...cc.classes, changes: [...(found?.changes ?? []), ...(cc.classes?.changes ?? [])] } as ClassesConfig
      : undefined;
    classes.push(...buildClasses({
      code: cc.code, cfg: slot, weeks, joinUrl, groups: live.courses?.[cc.code]?.groups ?? [],
      general: (weeks.find((w) => w.index === 0)?.items ?? []).filter((x) => x.kind === "file"),
      timeZone: cfg.timezone ?? "Europe/Nicosia",
    }));
    courses.push({
      code: cc.code, title: cc.title, short: cc.short, color: cc.color, weeks, grades, joinUrl,
      classTimeFrom: cc.classes ? "your settings" : found?.source ? `eClass: “${found.source}”` : undefined,
      eclassUrl: cc.eclassId ? `https://eclass.ouc.ac.cy/course/view.php?id=${cc.eclassId}` : "",
    });
  }

  assignments.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const exams: Exam[] = examsRaw.map((e) => ({
    code: e.code, kind: e.kind, at: e.at.length === 16 ? `${e.at}:00` : e.at, noTime: !!e.notime,
    source: cfg.examTimetable ? fileHref(id, cfg.examTimetable) : undefined,
  })).sort((a, b) => a.at.localeCompare(b.at));

  // daily update feed
  const ud = join(dir, "updates");
  const updates: UpdatesFeed = {
    status: readJson(join(ud, "status.json"), undefined),
    liveUpdated: live.updated,
    days: listFiles(ud).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().slice(0, 60)
      .map((f) => readJson<{ date: string; items: any[] }>(join(ud, f), { date: f.slice(0, 10), items: [] }))
      .filter((d) => d.items.length),
  };

  // week plans (plan-week skill), newest first
  const pd = join(dir, "plans");
  const plans = listFiles(pd).filter((f) => /^\d{4}-W\d{1,2}\.md$/.test(f)).sort().reverse()
    .map((f) => parsePlan(readFileSync(join(pd, f), "utf8"), f));

  return {
    id, label: cfg.label, start: cfg.start, end: cfg.end, generated: new Date().toISOString(),
    courses, assignments, exams, classes, notes, updates, plans, timezone: cfg.timezone ?? "Europe/Nicosia",
  };
}

/** Plain-text deadline list for the AI agents (the app shows the same data visually). */
function deadlinesMarkdown(d: SemesterData): string {
  const name = Object.fromEntries(d.courses.map((c) => [c.code, c.short]));
  const fmt = (s: string) => new Date(s).toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const rows = d.assignments.map((a) => `| ${a.due ? fmt(a.due) : "—"} | ${name[a.code]} | ${a.title} | ${a.submitted ? "✅ " : ""}${a.status} | assignments/${a.id}/ |`);
  const ex = d.exams.map((e) => `| ${e.noTime ? new Date(e.at).toDateString() : fmt(e.at)} | ${name[e.code]} | ${e.kind} |`);
  const weekOf = (c: ClassSession) => d.courses.find((x) => x.code === c.code)?.weeks.find((w) => w.index === c.weekIndex);
  const cl = d.classes.filter((c) => new Date(c.end) >= new Date()).map((c) =>
    `| ${fmt(c.at)}${c.status === "cancelled" ? " (cancelled)" : c.status === "moved" ? " (moved)" : ""} | ${name[c.code]} | ${weekOf(c)?.label ?? ""} | ${c.joinUrl ?? ""} |`);
  return [`# Deadlines: ${d.label}`, "", `_Generated by \`npm run content\` on ${new Date().toISOString().slice(0, 16)}. Times as shown on eClass. Don't edit; change _meta/ instead._`, "",
    "| Due | Course | Item | Status | Folder |", "|---|---|---|---|---|", ...rows, "", "## Exams", "", "| Date | Course | Exam |", "|---|---|---|", ...ex, "",
    ...(cl.length ? ["## Live classes (webconferences)", "", "_Times read from eClass announcements (or semester.json \"classes\"), shown in this computer's time zone._", "", "| When | Course | Week's topic | Join |", "|---|---|---|---|", ...cl, ""] : [])].join("\n");
}

function main() {
  if (!existsSync(SEMESTERS)) throw new Error(`No semesters folder at ${SEMESTERS}`);
  mkdirSync(OUT, { recursive: true });
  const index: SemesterIndex = { generated: new Date().toISOString(), semesters: [] };
  for (const id of readdirSync(SEMESTERS).sort()) {
    if (!statSync(join(SEMESTERS, id)).isDirectory()) continue;
    const data = buildSemester(id);
    if (!data) continue;
    writeFileSync(join(OUT, `${id}.json`), JSON.stringify(data));
    writeFileSync(join(SEMESTERS, id, "DEADLINES.md"), deadlinesMarkdown(data));
    const summary: SemesterSummary = {
      id: data.id, label: data.label, start: data.start, end: data.end,
      courses: data.courses.map((c) => ({ code: c.code, short: c.short, color: c.color })),
    };
    index.semesters.push(summary);
    console.log(`✓ ${id}: ${data.courses.length} courses, ${data.assignments.length} assignments, ${data.notes.length} notes, ${data.exams.length} exams, ${data.classes.length} classes`);
  }
  writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 1));
}

main();
