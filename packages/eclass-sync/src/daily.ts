/**
 * eClass daily sync: asks OUC eClass (Moodle) what changed since the last run, using the
 * official web-service API that the Moodle mobile app uses.
 *
 *   node packages/eclass-sync/daily.mjs            run a sync (also: npm run sync)
 *   node packages/eclass-sync/daily.mjs --check    only test that the key works
 *   node packages/eclass-sync/daily.mjs --quiet    no macOS notification
 *
 * Needs your personal key in  <repo>/.eclass-token  (one line). It never leaves this computer
 * except to eclass.ouc.ac.cy, and is never written to logs.
 *
 * Writes, for the current semester (semesters/<id>/):
 *   updates/<YYYY-MM-DD>.json   the changes found that day (appended on repeat runs)
 *   updates/status.json         last run time, success or error
 *   _meta/sync-state.json       snapshot used to detect changes next time
 *   _meta/live.json             latest grades / submission status / feedback / due dates, and per course the
 *                               Webconference join link, your teaching groups and recent forum posts (merged into the app)
 * Runs through the tsx launcher daily.mjs (started by name by the background LaunchAgent / scheduled task).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import type { CourseConfig, SemesterConfig } from "../../content/src/eclass.ts";
import type { UpdateItem, UpdateType } from "../../content/src/types.ts";
import type { MoodleApi, Params } from "./moodle.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SITE = process.env.ECLASS_URL ?? "https://eclass.ouc.ac.cy";
const now = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

// ---------- the Moodle answers this file reads (on top of moodle.ts) ----------
interface GradeItem { id: number; itemname?: string | null; itemtype?: string; cmid?: number; graderaw?: number | null; gradeformatted?: string; feedback?: string; gradedategraded?: number | null }
interface Forum { id: number; course: number; name: string; type?: string }
interface Discussion { id: number; discussion?: number; name?: string; subject?: string; userfullname?: string; message?: string; created?: number; timemodified?: number; modified?: number }
interface PopupNotification { id: number; subject?: string; smallmessage?: string; fullmessage?: string; timecreated?: number; contexturl?: string }
interface ActionEvent { id: number; name: string; timesort?: number; url?: string; modulename?: string; course?: { id: number } }
interface DailyApi extends MoodleApi {
  gradereport_user_get_grade_items: { usergrades?: { gradeitems?: GradeItem[] }[] };
  core_group_get_course_user_groups: { groups?: { name: string }[] };
  mod_forum_get_forums_by_courses: Forum[];
  mod_forum_get_forum_discussions: { discussions?: Discussion[] };
  mod_forum_get_discussion_posts: { posts?: { message?: string; author?: { fullname?: string }; timecreated?: number }[] };
  message_popup_get_popup_notifications: { notifications?: PopupNotification[] };
  core_calendar_get_action_events_by_timesort: { events?: ActionEvent[] };
}
/** An error from call(): fatal ones stop the sync, skip = the key may not call that function. */
type SyncError = Error & { fatal?: boolean; skip?: boolean; state?: string };

// ---------- what the sync writes (_meta/sync-state.json, _meta/live.json, updates/*.json) ----------
export interface GradeRec { code: string; item: string; cmid?: number; grade: string; feedback: string; graded?: string }
export interface AssignRec {
  code?: string; id: number; cmid: number; name: string; due?: string; opened?: string; url: string;
  status?: string; submittedAt?: string; gradingstatus?: string; grade?: string; feedback?: string;
}
export interface ModuleRec { code: string; name: string; type: string; section: string; url: string }
export interface FileRec { code: string; module: string; file: string; modified: number; url?: string }
/** text: the whole first post, paragraphs kept; last: the newest reply, fetched only when the thread has new replies. */
export interface DiscussionRec { code?: string; forum: string; subject: string; by?: string; text: string; modified?: number; url: string; announcement: boolean; last?: { by?: string; text: string } }
export interface NotificationRec { subject: string; text: string; at?: string; url?: string }
export interface EventRec { code: string; name: string; at?: string; url?: string; module?: string }
/** Per course in live.json: the Webconference link, your teaching groups, recent forum first posts. */
export interface CourseLive { joinUrl?: string; groups?: string[]; posts?: { at?: string; text: string }[] }
/** _meta/sync-state.json: everything compared with the next run (keys are Moodle ids). */
export interface Snapshot {
  userid: number; user: string;
  grades: Record<string, GradeRec>; assignments: Record<string, AssignRec>; modules: Record<string, ModuleRec>; files: Record<string, FileRec>;
  discussions: Record<string, DiscussionRec>; notifications: Record<string, NotificationRec>; events: Record<string, EventRec>; courses: Record<string, CourseLive>;
}
export interface LiveFile { updated: string; assignments: Record<string, AssignRec>; grades: GradeRec[]; courses: Record<string, CourseLive> }
export interface DayFile { date: string; items: UpdateItem[] }
/** updates/status.json */
interface SyncStatus { ok: boolean; state?: string; error?: string; found?: number; warnings?: string[] }
/** updates/connection.json */
interface Connection { ok: boolean; state: string; error?: string; user?: string; site?: string; functions?: number }

// set by main()
let ARGS = new Set<string>();
let JSON_OUT = false;
let UPD = "";
let TOKEN = "";

// ---------- semester ----------
function currentSemester(): (SemesterConfig & { id: string }) | undefined {
  const dir = join(ROOT, "semesters");
  const sems = readdirSync(dir).filter((d) => existsSync(join(dir, d, "semester.json")))
    .map((id): SemesterConfig & { id: string } => ({ id, ...JSON.parse(readFileSync(join(dir, id, "semester.json"), "utf8")) }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const iso = today;
  return sems.find((s) => s.start <= iso && iso <= s.end) ?? sems[sems.length - 1];
}
const log = (msg: string) => appendFileSync(join(UPD, "sync.log"), `${new Date().toISOString()} ${msg}\n`);

function writeStatus(s: SyncStatus) {
  writeFileSync(join(UPD, "status.json"), JSON.stringify({ lastRun: now.toISOString(), ...s }, null, 1));
}
function fail(msg: string, code = 1, state = "error"): never {
  const checking = ARGS.has("--check");
  // before the semester is known there is nowhere to write
  if (UPD) try {
    if (checking) writeConnection({ ok: false, state, error: msg });
    else { writeStatus({ ok: false, state, error: msg }); writeConnection({ ok: false, state, error: msg }); }
    log(`ERROR ${msg}`);
  } catch {}
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, state, error: msg }));
  else console.error(`✗ ${msg}`);
  process.exit(code);
}
/** updates/connection.json: is the key working right now? (read by the app's status dot) */
function writeConnection(c: Connection) {
  try { writeFileSync(join(UPD, "connection.json"), JSON.stringify({ checkedAt: new Date().toISOString(), ...c }, null, 1)); } catch {}
}

// ---------- Moodle REST client ----------
function encodeParams(obj: Params, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === "object") encodeParams(v as Params, key, out);
    else out.append(key, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  return out;
}
let available: Set<string> | null = null; // set of functions the token may call
async function call<F extends keyof DailyApi>(fn: F, params: Params = {}): Promise<DailyApi[F]> {
  if (available && !available.has(fn)) throw Object.assign(new Error(`${fn} is not enabled for your key`), { skip: true });
  const body = encodeParams({ wstoken: TOKEN, wsfunction: fn, moodlewsrestformat: "json", ...params });
  let res;
  try {
    res = await fetch(`${SITE}/webservice/rest/server.php`, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    throw Object.assign(new Error(`Can't reach eClass (${err.cause?.code ?? err.message}). Are you online?`), { fatal: true, state: "offline" });
  }
  if (!res.ok) throw Object.assign(new Error(`eClass answered HTTP ${res.status}`), { fatal: res.status >= 500 });
  const data = (await res.json()) as { exception?: string; errorcode?: string; message?: string } | null;
  if (data && data.exception) {
    const fatal = /invalidtoken|accessexception|webservicesnotenabled/i.test(data.errorcode ?? "");
    throw Object.assign(new Error(data.errorcode === "invalidtoken" ? "Your eClass key has expired or is invalid. Run ouc setup to add a new one." : `${fn}: ${data.message}`), { fatal, state: data.errorcode === "invalidtoken" ? "invalid" : "error" });
  }
  return data as DailyApi[F];
}
const strip = (h = "") => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
/** HTML → plain text that keeps its paragraphs and line breaks (forum posts are shown in full). */
export const paragraphs = (h = "") => strip(h.replace(/<br\s*\/?>/gi, "\u0001").replace(/<\/(p|div|li|h\d|blockquote|tr)>/gi, "\u0002").replace(/<li[^>]*>/gi, "• "))
  .replace(/ ?\u0001 ?/g, "\n").replace(/( ?\u0002 ?)+/g, "\n\n").replace(/\n{3,}/g, "\n\n").trim();
const FULL = 20_000; // a forum post longer than this is surely not text worth keeping whole
const short = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const iso = (sec?: number | null) => (sec ? new Date(sec * 1000).toISOString() : undefined);
const localIso = (sec?: number) => {
  if (!sec) return undefined;
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
};

// ---------- gather a snapshot ----------
async function gather(sem: SemesterConfig, prev: Partial<Snapshot> | null): Promise<{ snap: Snapshot; warnings: string[] }> {
  const info = await call("core_webservice_get_site_info");
  available = new Set((info.functions ?? []).map((f) => f.name));
  if (available.size === 0) available = null; // older sites don't list functions
  const userid = info.userid;
  const courses = sem.courses.filter((c): c is CourseConfig & { eclassId: number } => !!c.eclassId);
  const byId: Record<number, string | undefined> = Object.fromEntries(courses.map((c) => [c.eclassId, c.code]));
  const courseids = courses.map((c) => c.eclassId);
  const snap: Snapshot = { userid, user: info.fullname, grades: {}, assignments: {}, modules: {}, files: {}, discussions: {}, notifications: {}, events: {}, courses: {} };
  const warnings: string[] = [];
  const soft = async (label: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { const err = e as SyncError; if (err.fatal) throw e; warnings.push(`${label}: ${err.message}`); } };

  // grades
  for (const c of courses) {
    await soft(`grades ${c.code}`, async () => {
      const g = await call("gradereport_user_get_grade_items", { courseid: c.eclassId, userid });
      for (const it of g.usergrades?.[0]?.gradeitems ?? []) {
        if (it.itemtype === "course" && !it.graderaw) continue;
        snap.grades[`${c.code}:${it.id}`] = {
          code: c.code, item: it.itemname || (it.itemtype === "course" ? "Course total" : "Grade item"), cmid: it.cmid,
          grade: it.gradeformatted && it.gradeformatted !== "-" ? strip(it.gradeformatted) : "", feedback: strip(it.feedback ?? ""),
          graded: iso(it.gradedategraded),
        };
      }
    });
  }
  // assignments (+ submission status & feedback)
  await soft("assignments", async () => {
    const a = await call("mod_assign_get_assignments", { courseids });
    for (const course of a.courses ?? []) {
      for (const as of course.assignments ?? []) {
        const rec: AssignRec = {
          code: byId[course.id], id: as.id, cmid: as.cmid, name: as.name, due: localIso(as.duedate), opened: localIso(as.allowsubmissionsfromdate),
          url: `${SITE}/mod/assign/view.php?id=${as.cmid}`,
        };
        await soft(`status ${as.name}`, async () => {
          const s = await call("mod_assign_get_submission_status", { assignid: as.id });
          const sub = s.lastattempt?.submission;
          rec.status = sub?.status ?? "new";
          rec.submittedAt = iso(sub?.timemodified);
          rec.gradingstatus = s.lastattempt?.gradingstatus;
          rec.grade = s.feedback?.gradefordisplay ? strip(s.feedback.gradefordisplay) : "";
          const comments = (s.feedback?.plugins ?? []).find((p) => p.type === "comments");
          rec.feedback = strip(comments?.editorfields?.[0]?.text ?? "");
        });
        snap.assignments[as.cmid] = rec;
      }
    }
  });
  // course contents: new activities and changed files
  for (const c of courses) {
    await soft(`contents ${c.code}`, async () => {
      const secs = await call("core_course_get_contents", { courseid: c.eclassId });
      for (const s of secs ?? []) {
        for (const m of s.modules ?? []) {
          if (m.modname === "label") continue;
          // the live classes' join link (an LTI tool named "Webconference" / "Τηλεσυναντήσεις")
          if (m.modname === "lti" && /web\s*-?\s*confer|τηλεσυν/i.test(m.name ?? "") && m.url) (snap.courses[c.code] ??= {}).joinUrl ??= m.url;
          snap.modules[m.id] = { code: c.code, name: strip(m.name), type: m.modname, section: strip(s.name), url: m.url ?? `${SITE}/course/view.php?id=${c.eclassId}` };
          for (const f of m.contents ?? []) {
            if (f.type !== "file") continue;
            snap.files[`${m.id}:${f.filename}`] = { code: c.code, module: strip(m.name), file: f.filename, modified: f.timemodified, url: m.url };
          }
        }
      }
    });
  }
  // teaching groups (a course split into sections meets at different times, e.g. "2026_COS512_F.03")
  for (const c of courses) {
    await soft(`groups ${c.code}`, async () => {
      const g = await call("core_group_get_course_user_groups", { courseid: c.eclassId, userid }).catch((e: SyncError): DailyApi["core_group_get_course_user_groups"] => { if (e.skip) return {}; throw e; });
      const names = (g.groups ?? []).map((x) => strip(x.name)).filter(Boolean);
      if (names.length) (snap.courses[c.code] ??= {}).groups = names;
    });
  }
  // forums: announcements & discussions
  await soft("forums", async () => {
    const forums = await call("mod_forum_get_forums_by_courses", { courseids });
    for (const f of forums ?? []) {
      await soft(`forum ${f.name}`, async () => {
        const d = await call("mod_forum_get_forum_discussions", { forumid: f.id, sortorder: -1, page: 0, perpage: 40 });
        for (const [n, x] of (d.discussions ?? []).entries()) {
          // full first posts: the content build reads the live-class times from them (packages/content/src/classes.ts)
          const code = byId[f.course];
          if (code) ((snap.courses[code] ??= {}).posts ??= []).push({ at: localIso(x.created ?? x.timemodified), text: strip(x.message ?? "").slice(0, 3000) });
          if (n >= 15) continue; // the change feed watches the newest 15, as before
          const id = x.discussion ?? x.id;
          const rec: DiscussionRec = snap.discussions[id] = {
            code: byId[f.course], forum: strip(f.name), subject: strip(x.subject ?? x.name), by: x.userfullname,
            text: paragraphs(x.message ?? "").slice(0, FULL), modified: x.timemodified ?? x.modified, url: `${SITE}/mod/forum/discuss.php?d=${id}`,
            announcement: f.type === "news",
          };
          // new replies: keep the newest one's text, so the update shows it whole (older eClass versions may not offer this)
          const p = prev?.discussions?.[id];
          if (p && Number(rec.modified) > Number(p.modified)) {
            try {
              const r = await call("mod_forum_get_discussion_posts", { discussionid: id, sortby: "created", sortdirection: "DESC" });
              const last = r.posts?.[0];
              if (last?.message) rec.last = { by: last.author?.fullname, text: paragraphs(last.message).slice(0, FULL) };
            } catch {}
          }
        }
      });
    }
  });
  // notifications
  await soft("notifications", async () => {
    const n = await call("message_popup_get_popup_notifications", { useridto: userid, newestfirst: 1, limit: 30, offset: 0 });
    for (const x of n.notifications ?? []) {
      snap.notifications[x.id] = { subject: strip(x.subject ?? ""), text: short(strip(x.smallmessage ?? x.fullmessage ?? "")), at: iso(x.timecreated), url: x.contexturl };
    }
  });
  // upcoming calendar events (quizzes, sessions, deadlines)
  await soft("calendar", async () => {
    const e = await call("core_calendar_get_action_events_by_timesort", { timesortfrom: Math.floor(Date.now() / 1000) - 86400, limitnum: 50 });
    for (const x of e.events ?? []) {
      snap.events[x.id] = { code: (x.course ? byId[x.course.id] : undefined) ?? "", name: strip(x.name), at: localIso(x.timesort), url: x.url, module: x.modulename };
    }
  });
  return { snap, warnings };
}

// ---------- compare snapshots ----------
/** The update items between the last snapshot (as read back from sync-state.json) and this one. */
export function diff(prev: Partial<Snapshot>, cur: Snapshot): UpdateItem[] {
  const out: UpdateItem[] = [];
  const add = (type: UpdateType, code: string | undefined, title: string, detail = "", url = "") => out.push({ type, code: code ?? "", title, detail, url, at: now.toISOString() });
  for (const [k, g] of Object.entries(cur.grades)) {
    const p = prev.grades?.[k];
    if (g.grade && (!p || p.grade !== g.grade)) add("grade", g.code, `New grade: ${g.item}`, `${g.grade}${p?.grade ? ` (was ${p.grade})` : ""}`, g.cmid ? `${SITE}/mod/assign/view.php?id=${g.cmid}` : "");
    else if (g.feedback && p && p.feedback !== g.feedback) add("feedback", g.code, `Feedback on ${g.item}`, short(g.feedback));
  }
  for (const [k, a] of Object.entries(cur.assignments)) {
    const p = prev.assignments?.[k];
    if (!p) { add("assignment", a.code, `New assignment: ${a.name}`, a.due ? `Due ${a.due.replace("T", " ").slice(0, 16)}` : "", a.url); continue; }
    if (p.due !== a.due && a.due) add("deadline", a.code, `Deadline changed: ${a.name}`, `${(p.due ?? "none").replace("T", " ").slice(0, 16)} → ${a.due.replace("T", " ").slice(0, 16)}`, a.url);
    if (a.status && p.status !== a.status) add("submission", a.code, `${a.name}: ${a.status === "submitted" ? "submitted ✓" : a.status}`, a.submittedAt ? `at ${a.submittedAt.slice(0, 16).replace("T", " ")}` : "", a.url);
    if (a.grade && p.grade !== a.grade && !Object.values(cur.grades).some((g) => g.cmid === a.cmid && g.grade === a.grade)) add("grade", a.code, `New grade: ${a.name}`, a.grade, a.url);
    if (a.feedback && p.feedback !== a.feedback) add("feedback", a.code, `Tutor feedback on ${a.name}`, short(a.feedback), a.url);
  }
  for (const [k, m] of Object.entries(cur.modules)) if (!prev.modules?.[k] && m.type !== "assign") add("material", m.code, `New ${m.type === "resource" ? "file" : m.type}: ${m.name}`, m.section, m.url);
  for (const [k, f] of Object.entries(cur.files)) {
    const p = prev.files?.[k];
    if (p && f.modified > p.modified) add("material", f.code, `Updated file: ${f.file}`, f.module, f.url);
    else if (!p && prev.modules?.[k.split(":")[0]!]) add("material", f.code, `New file in ${f.module}: ${f.file}`, "", f.url);
  }
  for (const [k, d] of Object.entries(cur.discussions)) {
    const p = prev.discussions?.[k];
    if (!p) add(d.announcement ? "announcement" : "forum", d.code, `${d.announcement ? "Announcement" : "New post"}: ${d.subject}`, `${d.by ? `${d.by}: ` : ""}${d.text}`, d.url);
    // NaN (no time) compares false, as undefined did
    else if (Number(d.modified) > Number(p.modified)) add("forum", d.code, `New replies: ${d.subject}`, d.last ? `${d.last.by ? `${d.last.by}: ` : ""}${d.last.text}` : d.forum, d.url);
  }
  for (const [k, n] of Object.entries(cur.notifications)) if (!prev.notifications?.[k]) add("notification", "", n.subject || "eClass notification", n.text, n.url);
  for (const [k, e] of Object.entries(cur.events)) {
    if (prev.events?.[k] || e.module === "assign") continue;
    add("event", e.code, `Upcoming: ${e.name}`, e.at ? e.at.replace("T", " ").slice(0, 16) : "", e.url);
  }
  return out;
}

// ---------- main ----------
/** `ouc sync` / the background job (daily.mjs): exit code 2 when there is no usable key. */
export async function main(args: string[]): Promise<void> {
  ARGS = new Set(args);
  JSON_OUT = ARGS.has("--json");
  const SEM = currentSemester();
  if (!SEM) fail("No semesters/*/semester.json found.");
  const SEMDIR = join(ROOT, "semesters", SEM.id);
  UPD = join(SEMDIR, "updates");
  mkdirSync(UPD, { recursive: true });
  mkdirSync(join(SEMDIR, "_meta"), { recursive: true });

  // ---------- token ----------
  const tokenFile = join(ROOT, ".eclass-token");
  if (!existsSync(tokenFile)) fail("No eClass key yet. Run: ouc setup", 2, "nokey");
  TOKEN = readFileSync(tokenFile, "utf8").trim();
  if (!/^[a-f0-9]{32}$/i.test(TOKEN)) fail("The .eclass-token file doesn't look like a 32-character eClass key. Run: ouc setup", 2, "badkey");

  try {
    if (ARGS.has("--check")) {
      const info = await call("core_webservice_get_site_info");
      const c: Connection = { ok: true, state: "connected", user: info.fullname, site: info.sitename, functions: (info.functions ?? []).length };
      writeConnection(c);
      if (JSON_OUT) console.log(JSON.stringify(c));
      else console.log(`✓ Key works. Signed in as ${info.fullname} on ${info.sitename} (${c.functions} API functions available).`);
      return;
    }
    const statePath = join(SEMDIR, "_meta/sync-state.json");
    const prev: Partial<Snapshot> | null = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
    const { snap, warnings } = await gather(SEM, prev);
    let items = prev ? diff(prev, snap) : [];
    if (!prev) {
      items = [{
        type: "baseline", code: "", at: now.toISOString(),
        title: "Daily updates switched on",
        detail: `Saved a baseline of ${Object.keys(snap.grades).length} grade items, ${Object.keys(snap.assignments).length} assignments, ${Object.keys(snap.modules).length} activities and ${Object.keys(snap.discussions).length} forum threads. From now on, changes appear here.`,
        url: "",
      }];
    }
    // append to today's file, without duplicating identical items from an earlier run today
    const dayFile = join(UPD, `${today}.json`);
    const existing: DayFile = existsSync(dayFile) ? JSON.parse(readFileSync(dayFile, "utf8")) : { date: today, items: [] };
    const seen = new Set(existing.items.map((i) => `${i.type}|${i.title}|${i.detail}`));
    const fresh = items.filter((i) => !seen.has(`${i.type}|${i.title}|${i.detail}`));
    if (fresh.length || !existsSync(dayFile)) writeFileSync(dayFile, JSON.stringify({ date: today, items: [...existing.items, ...fresh] } satisfies DayFile, null, 1));

    writeFileSync(statePath, JSON.stringify(snap));
    writeFileSync(join(SEMDIR, "_meta/live.json"), JSON.stringify({
      updated: now.toISOString(),
      assignments: snap.assignments,
      grades: Object.values(snap.grades),
      courses: snap.courses,
    } satisfies LiveFile, null, 1));
    writeStatus({ ok: true, found: fresh.length, warnings });
    writeConnection({ ok: true, state: "connected", user: snap.user });
    log(`OK ${fresh.length} new item(s)${warnings.length ? `; ${warnings.length} warning(s): ${warnings.join(" | ")}` : ""}`);
    if (JSON_OUT) { console.log(JSON.stringify({ ok: true, state: "connected", found: fresh.length, items: fresh })); }
    else console.log(`✓ eClass sync: ${fresh.length} new update(s) for ${SEM.label}.${warnings.length ? ` (${warnings.length} parts skipped, see updates/status.json)` : ""}`);
    if (!JSON_OUT) for (const i of fresh) console.log(`  • [${i.type}] ${i.code ? `${i.code} ` : ""}${i.title}${i.detail ? ` · ${i.detail}` : ""}`);

    const real = fresh.filter((i) => i.type !== "baseline");
    if (real.length && process.platform === "darwin" && !ARGS.has("--quiet")) {
      const top = real.find((i) => i.type === "grade") ?? real.find((i) => i.type === "feedback") ?? real[0]!;
      const msg = `${real.length} new on eClass: ${top.title}`.replace(/["\\]/g, "");
      execFile("osascript", ["-e", `display notification "${msg}" with title "OUC Study" sound name "Glass"`], () => {});
    }
  } catch (e) {
    const err = e as SyncError;
    fail(err.message, 1, err.state ?? "error");
  }
}
