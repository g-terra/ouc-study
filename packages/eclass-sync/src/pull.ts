/**
 * Pull a semester from eClass through the web-service API: course structure, every file,
 * assignment briefs and your own submissions, into the folder layout the app reads.
 *
 *   node packages/eclass-sync/pull.mjs              download what's missing for the current semester
 *   node packages/eclass-sync/pull.mjs --dry-run    change nothing; write a report to .ouc/dry-run/
 *   node packages/eclass-sync/pull.mjs --semester 2026-Fall
 *
 * Never overwrites or deletes a file that already exists. When eClass has a newer version of a
 * file you already have, it is saved next to it as "name (updated YYYY-MM-DD).ext".
 * Used by `ouc setup` (first install) and `ouc sync` (new files every day).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CourseConfig, MetaActivity, MetaCourse, MetaSection, SemesterConfig, SubmissionRecord } from "../../content/src/eclass.ts";
import { createClient, eclassDate, htmlToText, isoDay, links, pad, readToken, safeName, slug, strip, type MoodleAssignment, type MoodleClient, type MoodleError } from "./moodle.ts";
import { MEDIA_FILE, loadMediaConfig, panoptoCaptions, panoptoSession, srtToSegments, transcriptMarkdown } from "./media.ts";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// installers are never downloaded (they stay a link to eClass)
const INSTALLER = /\.(pkg|dmg|exe|msi|deb|rpm|appimage|apk)$/i;
const norm = (s: unknown) => String(s).replace(/\s+/g, " ").trim();
const humanStatus: Record<string, string> = { submitted: "Submitted for grading", draft: "Draft (not submitted)", new: "No submissions have been made yet", reopened: "Reopened" };
const shortAssignName = (name: unknown) => String(name).replace(/\s*\(due date:[^)]*\)/, "").trim();
const assignFolder = (name: string, duedate?: number) => {
  const short = shortAssignName(name);
  if (!duedate) return slug(short, 45);
  const d = new Date(duedate * 1000);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${slug(short, 45)}`;
};

/** A progress event: reading course pages ("list") or downloading files. */
export interface PullEvent { phase: "list" | "download"; course?: string; done?: number; total?: number; detail?: string }
interface Task { url: string; rel: string; size: number; modified: number }
export interface PullReport {
  semester: string; dryRun: boolean; warnings: string[];
  courses: { code: string; sections: number; files: number }[];
  files: { total: number; existing: number; downloaded: number; failed: number; updated: number; bytes: number; toDownload: string[]; changed: Task[]; errors: string[] };
  assignments: { total: number; newFolders: string[]; briefs: number; submissions: number };
  /** class videos: files queued with the others; Panopto links (captions saved when Panopto shares them) */
  videos: { files: number; panopto: number; captions: number; signin: number };
}
export interface PullOptions {
  root?: string;
  semId: string;            // folder name under semesters/
  cfg: SemesterConfig;      // parsed semester.json
  client: MoodleClient;
  dryRun?: boolean;
  on?: (ev: PullEvent) => void;
  fetchImpl?: typeof fetch;  // tests: Panopto answers
}
/** An error from eClass: fatal ones (offline, bad key) stop the pull, others skip that part. */
const isFatal = (e: unknown) => !!(e as MoodleError).fatal;
const msg = (e: unknown) => (e as Error).message;

export async function pull({ root = ROOT, semId, cfg, client, dryRun = false, on = () => {}, fetchImpl = fetch }: PullOptions): Promise<PullReport> {
  const semDir = join(root, "semesters", semId);
  const outDir = dryRun ? join(root, ".ouc", "dry-run", semId) : semDir;
  const report: PullReport = {
    semester: semId, dryRun, courses: [], warnings: [],
    files: { total: 0, existing: 0, downloaded: 0, failed: 0, updated: 0, bytes: 0, toDownload: [], changed: [], errors: [] },
    assignments: { total: 0, newFolders: [], briefs: 0, submissions: 0 },
    videos: { files: 0, panopto: 0, captions: 0, signin: 0 },
  };
  const media = loadMediaConfig(root);
  const panopto: { url: string; title: string; rel: string }[] = [];   // Panopto links → captions to try
  const courses = cfg.courses.filter((c): c is CourseConfig & { eclassId: number } => !!c.eclassId);
  const courseids = courses.map((c) => c.eclassId);
  const tasks: Task[] = [];
  const queue = (url: string | undefined, rel: string, size = 0, modified = 0) => { if (url) tasks.push({ url, rel, size, modified }); };

  // ---- assignments (intro, attachments, due dates) for every course in one call
  on({ phase: "list", detail: "assignments" });
  const assigns = new Map<number, MoodleAssignment>();
  try {
    const a = await client.call("mod_assign_get_assignments", { courseids });
    for (const course of a.courses ?? []) for (const as of course.assignments ?? []) assigns.set(as.cmid, as);
  } catch (e) { if (isFatal(e)) throw e; report.warnings.push(`assignments: ${msg(e)}`); }

  const meta: MetaCourse[] = [];
  const subs: SubmissionRecord[] = [];
  const oldMetaPath = join(semDir, "_meta", "eclass-meta.json");
  const oldMeta: MetaCourse[] = existsSync(oldMetaPath) ? JSON.parse(readFileSync(oldMetaPath, "utf8")) : [];
  for (const cc of courses) {
    on({ phase: "list", course: cc.code, detail: cc.short });
    let secs;
    try { secs = await client.call("core_course_get_contents", { courseid: cc.eclassId }); }
    catch (e) { if (isFatal(e)) throw e; report.warnings.push(`${cc.code}: ${msg(e)}`); continue; }
    const entry: MetaCourse = { id: String(cc.eclassId), code: cc.code, title: `${cc.code}: ${cc.title}`, source: "api", secs: [] };
    let nFiles = 0;
    for (const [idx, s] of (secs ?? []).entries()) {
      const i = typeof s.section === "number" && Number.isInteger(s.section) ? s.section : idx;
      const name = strip(s.name) || (i === 0 ? "General" : `Section ${i}`);
      const secRel = `courses/${cc.dir}/${pad(i)}-${slug(name)}`;
      const sec: MetaSection = { i, name, summary: htmlToText(s.summary), acts: [] };
      for (const m of s.modules ?? []) {
        if (m.uservisible === false || m.modname === "label") continue;
        const act: MetaActivity = { type: m.modname, name: strip(m.name), url: m.url ?? "", desc: htmlToText(m.description ?? "") };
        const files = (m.contents ?? []).filter((f) => f.type === "file" && f.fileurl);
        if (m.modname === "resource" && files.length && files.every((f) => INSTALLER.test(f.filename))) {
          act.desc = act.desc || "Installer: download it from eClass if you need it.";
        } else if (m.modname === "resource" && files.length) {
          const main = files.find((f) => f.sortorder === 1) ?? files[0];
          for (const f of files) {
            const sub = (f.filepath ?? "/").split("/").filter(Boolean).map(safeName).join("/");
            const inSec = [sub, safeName(f.filename)].filter(Boolean).join("/");
            queue(f.fileurl, `${secRel}/${inSec}`, f.filesize, f.timemodified); nFiles++;
            if (f === main) Object.assign(act, { file: f.filename, ctype: f.mimetype, size: f.filesize, fileurl: f.fileurl.replace(/[?&]forcedownload=1/, ""), local: `${cc.code}/${pad(i)}/${inSec}` });
          }
        } else if (m.modname === "folder" && files.length) {
          sec.acts.push(act);
          for (const f of files) {
            const sub = (f.filepath ?? "/").split("/").filter(Boolean).map(safeName);
            const inSec = [slug(act.name, 50), ...sub, safeName(f.filename)].join("/");
            queue(f.fileurl, `${secRel}/${inSec}`, f.filesize, f.timemodified); nFiles++;
            sec.acts.push({ type: "resource", name: `${act.name} · ${f.filename}`, url: m.url ?? "", desc: "", file: f.filename, size: f.filesize, local: `${cc.code}/${pad(i)}/${inSec}` });
          }
          continue;
        } else if (m.modname === "url") {
          act.target = (m.contents ?? []).find((f) => f.fileurl)?.fileurl ?? m.url;
          if (panoptoSession(act.target)) {
            // a Panopto recording: the eClass key can't download it, but its captions may be shared
            report.videos.panopto++;
            const inSec = `${slug(act.name, 50)}.transcript.md`;
            act.transcript = `${cc.code}/${pad(i)}/${inSec}`;
            if (media.transcribe) panopto.push({ url: act.target!, title: act.name, rel: `${secRel}/${inSec}` });
          }
        } else if (m.modname === "page") {
          const page = files.find((f) => /\.html?$/i.test(f.filename));
          if (page) { try { act.links = links(await client.getText(page.fileurl)); act.body = ""; } catch (e) { report.warnings.push(`page ${act.name}: ${msg(e)}`); } }
          // a video (or audio) embedded in the page: eClass lists it with the page's files
          const videos = files.filter((f) => f !== page && MEDIA_FILE.test(f.filename.split("?")[0]!));
          if (media.videos) for (const f of videos) {
            const inSec = [slug(act.name, 50), safeName(f.filename)].join("/");
            queue(f.fileurl, `${secRel}/${inSec}`, f.filesize, f.timemodified); nFiles++; report.videos.files++;
            if (f === videos[0]) Object.assign(act, { file: f.filename, ctype: f.mimetype, size: f.filesize, local: `${cc.code}/${pad(i)}/${inSec}` });
          }
        } else if (m.modname === "assign") {
          const as = assigns.get(m.id);
          if (as) {
            report.assignments.total++;
            act.dates = [
              as.allowsubmissionsfromdate ? `Opened: ${eclassDate(as.allowsubmissionsfromdate)}` : null,
              as.duedate ? `Due: ${eclassDate(as.duedate)}` : null,
            ].filter((d): d is string => !!d);
            act.body = htmlToText(as.intro ?? "");
            const folderRel = `assignments/${cc.code}/${assignFolder(as.name, as.duedate)}`;
            if (shortAssignName(as.name) !== "Exams Grade" && !existsSync(join(semDir, folderRel))) report.assignments.newFolders.push(folderRel);
            for (const f of as.introattachments ?? []) { queue(f.fileurl, `${folderRel}/${safeName(f.filename)}`, f.filesize, f.timemodified); report.assignments.briefs++; }
            // your own submission + feedback
            try {
              const st = await client.call("mod_assign_get_submission_status", { assignid: as.id });
              const sub = st.lastattempt?.submission ?? st.lastattempt?.teamsubmission;
              const rows: Record<string, string> = { "Submission status": humanStatus[sub?.status ?? "new"] ?? sub?.status ?? "" };
              if (st.feedback?.gradefordisplay) rows.Grade = strip(st.feedback.gradefordisplay);
              for (const p of sub?.plugins ?? []) {
                for (const fa of p.fileareas ?? []) for (const f of fa.files ?? []) { queue(f.fileurl, `${folderRel}/my-submission/${safeName(f.filename)}`, f.filesize, f.timemodified); report.assignments.submissions++; }
                const txt = p.type === "onlinetext" ? p.editorfields?.[0]?.text : "";
                if (txt && strip(txt)) act.onlineText = htmlToText(txt);
              }
              for (const p of st.feedback?.plugins ?? []) {
                if (p.type === "comments") { const t = strip(p.editorfields?.[0]?.text ?? ""); if (t) rows["Feedback comments"] = t; }
                for (const fa of p.fileareas ?? []) for (const f of fa.files ?? []) queue(f.fileurl, `${folderRel}/my-submission/feedback_${safeName(f.filename)}`, f.filesize, f.timemodified);
              }
              subs.push({ code: cc.code, name: act.name, url: act.url, rows, source: "api" });
            } catch (e) { if (isFatal(e)) throw e; report.warnings.push(`submission ${act.name}: ${msg(e)}`); }
            act.folder = folderRel;
            act.due = as.duedate;
          }
        }
        sec.acts.push(act);
      }
      entry.secs.push(sec);
    }
    // keep entries an earlier import added that the API doesn't list (e.g. forum attachments), if their file is here
    const old = oldMeta.find((x) => x.code === cc.code);
    for (const os of old?.secs ?? []) {
      const ns = entry.secs.find((x) => x.i === os.i);
      if (!ns) continue;
      for (const a of os.acts ?? []) {
        if (!a.local || ns.acts.some((x) => x.local === a.local)) continue;
        const rel = `courses/${cc.dir}/${pad(os.i)}-${slug(ns.name)}/${String(a.local).split("/").slice(2).join("/")}`;
        if (!existsSync(join(semDir, rel))) continue;
        const same = ns.acts.find((x) => norm(x.name) === norm(a.name) && !x.local);
        if (same) same.local = a.local;
        else if (!ns.acts.some((x) => norm(x.name) === norm(a.name))) ns.acts.push({ ...a, kept: true });
      }
    }
    meta.push(entry);
    report.courses.push({ code: cc.code, sections: entry.secs.length, files: nFiles });
  }

  // ---- work out which files are new / changed
  report.files.total = tasks.length;
  const todo: Task[] = [];
  for (const t of tasks) {
    const abs = join(semDir, t.rel);
    if (existsSync(abs)) {
      report.files.existing++;
      const st = statSync(abs);
      if (t.size && st.size !== t.size && t.modified * 1000 > st.mtimeMs) report.files.changed.push(t);
    } else { todo.push(t); report.files.bytes += t.size || 0; }
  }
  report.files.toDownload = todo.map((t) => t.rel);

  // ---- write meta (back up whatever was there before)
  mkdirSync(join(outDir, "_meta"), { recursive: true });
  const writeMeta = (name: string, data: unknown) => {
    const p = join(outDir, "_meta", name);
    const json = JSON.stringify(data, null, 1);
    if (!dryRun && existsSync(p) && readFileSync(p, "utf8") !== json) {
      mkdirSync(join(outDir, "_meta", "backup"), { recursive: true });
      // one backup per day is enough (the daily sync rewrites these files)
      const bak = join(outDir, "_meta", "backup", `${name.replace(/\.json$/, "")}.${isoDay(new Date())}.json`);
      if (!existsSync(bak)) copyFileSync(p, bak);
    }
    writeFileSync(p, json);
  };
  if (meta.length) writeMeta("eclass-meta.json", meta);
  if (subs.length) writeMeta("submissions.json", { subs, updated: new Date().toISOString() });

  if (dryRun) {
    writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 1));
    writeFileSync(join(outDir, "report.md"), reportMarkdown(report));
    return report;
  }

  // ---- download (4 at a time)
  const work: (Task & { dest: string; updated?: boolean })[] = [...todo.map((t) => ({ ...t, dest: join(semDir, t.rel) })),
    ...report.files.changed.map((t) => ({ ...t, updated: true, dest: join(semDir, t.rel.replace(/(\.[^./]+)?$/, (ext) => ` (updated ${isoDay(new Date(t.modified * 1000))})${ext}`)) }))]
    .filter((t) => !existsSync(t.dest));
  let done = 0;
  const total = work.length;
  on({ phase: "download", done, total });
  const worker = async () => {
    for (let t = work.shift(); t; t = work.shift()) {
      try { await client.download(t.url, t.dest); t.updated ? report.files.updated++ : report.files.downloaded++; }
      catch (e) { report.files.failed++; report.files.errors.push(`${t.rel}: ${msg(e)}`); }
      on({ phase: "download", done: ++done, total, detail: t.rel.split("/").pop() });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  // ---- Panopto captions as transcripts (once; a session that needs signing in is tried again next time)
  for (const p of panopto) {
    const dest = join(semDir, p.rel);
    if (existsSync(dest)) { report.videos.captions++; continue; }
    const r = await panoptoCaptions(p.url, fetchImpl);
    if (r.ok) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, transcriptMarkdown({ title: p.title, source: p.url, by: "Panopto captions" }, [{ segments: srtToSegments(r.srt) }]));
      report.videos.captions++;
    } else if (r.reason === "signin") report.videos.signin++;
  }

  // ---- READMEs for new assignment folders and courses (handy for Claude; never overwritten)
  for (const m of meta) {
    const cc = courses.find((c) => c.code === m.code)!;
    for (const s of m.secs) for (const a of s.acts) {
      if (a.type !== "assign" || !a.folder) continue;
      const p = join(semDir, a.folder, "README.md");
      if (existsSync(p) || shortAssignName(a.name) === "Exams Grade") continue;
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, [`# ${cc.short}: ${shortAssignName(a.name)}`, "", a.due ? `**Due:** ${eclassDate(a.due)}  ` : "", `**On eClass:** ${a.url}`, "",
        "## Brief", "", a.body || "_See the attached files._", "", "## My working notes", "", ""].join("\n"));
      if (a.onlineText) {
        const ot = join(semDir, a.folder, "my-submission", "online-text.md");
        if (!existsSync(ot)) { mkdirSync(dirname(ot), { recursive: true }); writeFileSync(ot, `${a.onlineText}\n`); }
      }
    }
    const cr = join(semDir, "courses", cc.dir, "README.md");
    if (!existsSync(cr)) {
      mkdirSync(dirname(cr), { recursive: true });
      const lines = [`# ${cc.title}`, "", `eClass: ${client.site}/course/view.php?id=${cc.eclassId}`, ""];
      for (const s of m.secs) {
        lines.push(`## ${s.name}`, "");
        for (const a of s.acts) lines.push(`- ${a.local ? `[${a.name}](${a.local.split("/").slice(2).map(encodeURIComponent).join("/").replace(/^/, `${pad(s.i)}-${slug(s.name)}/`)})` : `${a.name} (${a.type})`}`);
        lines.push("");
      }
      writeFileSync(cr, lines.join("\n"));
    }
  }
  writeFileSync(join(semDir, "_meta", "pull-report.json"), JSON.stringify({ ...report, at: new Date().toISOString() }, null, 1));
  return report;
}

export function reportMarkdown(r: PullReport): string {
  const L = [`# eClass pull ${r.dryRun ? "(dry run, nothing changed)" : ""}: ${r.semester}`, "",
    `| Course | Sections | Files |`, `|---|---|---|`, ...r.courses.map((c) => `| ${c.code} | ${c.sections} | ${c.files} |`), "",
    `- Files on eClass: **${r.files.total}**; already here: **${r.files.existing}**; new: **${r.files.toDownload.length}**; newer on eClass: **${r.files.changed.length}**`,
    `- Assignments: ${r.assignments.total}; brief files: ${r.assignments.briefs}; your submitted files: ${r.assignments.submissions}`,
    `- Class videos to download: ${r.videos.files}; Panopto recordings (links only): ${r.videos.panopto}`,
    r.assignments.newFolders.length ? `- New assignment folders: ${r.assignments.newFolders.map((f) => `\`${f}\``).join(", ")}` : "- No new assignment folders",
    "", "## Would download", "", ...r.files.toDownload.map((f) => `- ${f}`), "",
    "## Newer on eClass", "", ...r.files.changed.map((t) => `- ${t.rel}`), "",
    r.warnings.length ? `## Warnings\n\n${r.warnings.map((w) => `- ${w}`).join("\n")}` : ""];
  return L.join("\n");
}

// ---------- CLI ----------
function currentSemesterId(root: string): string | null {
  const dir = join(root, "semesters");
  if (!existsSync(dir)) return null;
  const today = isoDay(new Date());
  const sems = readdirSync(dir).filter((d) => existsSync(join(dir, d, "semester.json")))
    .map((id): SemesterConfig & { id: string } => ({ id, ...JSON.parse(readFileSync(join(dir, id, "semester.json"), "utf8")) })).sort((a, b) => a.start.localeCompare(b.start));
  return (sems.find((s) => s.start <= today && today <= s.end) ?? sems.at(-1))?.id ?? null;
}

/** `ouc pull` (pull.mjs): exit code 2 when there is no key or no semester yet. */
export async function main(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const quiet = args.includes("--quiet");
  const semId = args.includes("--semester") ? args[args.indexOf("--semester") + 1] : currentSemesterId(ROOT);
  const token = readToken(ROOT);
  if (!token) { console.error("✗ No valid eClass key in .eclass-token. Run: ouc setup"); process.exit(2); }
  if (!semId) { console.error("✗ No semester set up yet. Run: ouc setup"); process.exit(2); }
  const cfg: SemesterConfig = JSON.parse(readFileSync(join(ROOT, "semesters", semId, "semester.json"), "utf8"));
  const tty = process.stdout.isTTY && !quiet;
  await pull({ semId, cfg, client: createClient(token), dryRun, on: (e) => {
    if (!tty) return;
    if (e.phase === "list") process.stdout.write(`\r\x1b[2K  … reading ${e.detail ?? ""}`);
    if (e.phase === "download" && e.total) process.stdout.write(`\r\x1b[2K  ↓ ${e.done}/${e.total} ${e.detail ?? ""}`.slice(0, 100));
  } }).then((r) => {
    if (tty) process.stdout.write("\r\x1b[2K");
    const f = r.files;
    if (dryRun) console.log(`✓ Dry run: ${f.total} files on eClass, ${f.existing} already here, ${f.toDownload.length} new, ${f.changed.length} newer. Report: .ouc/dry-run/${semId}/report.md`);
    else console.log(`✓ eClass files: ${f.downloaded} new${f.updated ? `, ${f.updated} updated` : ""}, ${f.existing} already here${f.failed ? `, ${f.failed} failed (see _meta/pull-report.json)` : ""}.`);
    const v = r.videos;
    if (!dryRun && v.panopto && v.signin && !quiet) console.log(`  ${v.signin} Panopto recording(s) need a Panopto sign-in, so they stay links (transcripts only for videos on eClass).`);
    if (r.warnings.length && !quiet) console.log(`  ${r.warnings.length} part(s) skipped: ${r.warnings.slice(0, 3).join(" | ")}`);
  }).catch((e: unknown) => { console.error(`✗ ${msg(e)}`); process.exit(1); });
}
