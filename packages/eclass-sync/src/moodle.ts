// Shared Moodle web-service client (zero dependencies). Used by pull.ts and the installer (packages/cli/src/setup.ts).
// The key is only ever sent to the eClass site, never logged or printed.
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

// ---------- the parts of the Moodle web-service answers this code reads ----------
export interface MoodleFile { type?: string; filename: string; filepath?: string; filesize: number; fileurl: string; timemodified: number; mimetype?: string; sortorder?: number }
export interface MoodleModule { id: number; name: string; modname: string; url?: string; description?: string; uservisible?: boolean; contents?: MoodleFile[] }
export interface MoodleSection { id?: number; section?: number; name: string; summary?: string; modules?: MoodleModule[] }
export interface MoodleCourse { id: number; fullname: string; shortname: string; startdate?: number; enddate?: number }
export interface SiteInfo { userid: number; fullname: string; firstname?: string; sitename: string; functions?: { name: string }[] }
export interface MoodleAssignment {
  id: number; cmid: number; course?: number; name: string; intro?: string; duedate?: number; allowsubmissionsfromdate?: number; introattachments?: MoodleFile[];
}
interface EditorField { text?: string }
interface PluginData { type: string; fileareas?: { files?: MoodleFile[] }[]; editorfields?: EditorField[] }
export interface SubmissionStatus {
  lastattempt?: { submission?: { status?: string; timemodified?: number; plugins?: PluginData[] }; teamsubmission?: { status?: string; plugins?: PluginData[] }; gradingstatus?: string };
  feedback?: { gradefordisplay?: string; plugins?: PluginData[] };
}
/** What each web-service function the code calls returns (only the fields it reads). */
export interface MoodleApi {
  core_webservice_get_site_info: SiteInfo;
  core_enrol_get_users_courses: MoodleCourse[];
  core_course_get_contents: MoodleSection[];
  mod_assign_get_assignments: { courses?: { id: number; assignments?: MoodleAssignment[] }[] };
  mod_assign_get_submission_status: SubmissionStatus;
}
export type Params = { [key: string]: unknown };

export const SITE = process.env.ECLASS_URL ?? "https://eclass.ouc.ac.cy";
export const TOKEN_RE = /^[a-f0-9]{32}$/i;
export const pad = (n: number) => String(n).padStart(2, "0");

export function readToken(root: string): string | null {
  const f = join(root, ".eclass-token");
  if (!existsSync(f)) return null;
  const t = readFileSync(f, "utf8").trim();
  return TOKEN_RE.test(t) ? t : null;
}

function encodeParams(obj: Params, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === "object") encodeParams(v as Params, key, out);
    else out.append(key, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  return out;
}

export class MoodleError extends Error {
  state: string;
  fatal: boolean;
  code?: string;
  constructor(msg: string, { state = "error", fatal = false, code }: { state?: string; fatal?: boolean; code?: string } = {}) { super(msg); this.state = state; this.fatal = fatal; this.code = code; }
}
/** Why a request failed, for messages: the network error code (ENOTFOUND…) or the message. */
const reason = (e: unknown) => { const err = e as Error & { cause?: { code?: string } }; return err.cause?.code ?? err.message; };

export type MoodleClient = ReturnType<typeof createClient>;

export function createClient(token: string, site = SITE) {
  const withToken = (url: string) => {
    // pluginfile.php only accepts the key on the web-service variant of the URL
    const u = url.replace(/\/pluginfile\.php\//, "/webservice/pluginfile.php/").replace("/webservice/webservice/", "/webservice/");
    return `${u}${u.includes("?") ? "&" : "?"}token=${token}`;
  };
  function call<F extends keyof MoodleApi>(fn: F, params?: Params): Promise<MoodleApi[F]>;
  function call(fn: string, params?: Params): Promise<unknown>;
  async function call(fn: string, params: Params = {}): Promise<unknown> {
    const body = encodeParams({ wstoken: token, wsfunction: fn, moodlewsrestformat: "json", ...params });
    let res;
    try {
      res = await fetch(`${site}/webservice/rest/server.php`, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    } catch (e) {
      throw new MoodleError(`Can't reach eClass (${reason(e)}). Are you online?`, { state: "offline", fatal: true });
    }
    if (!res.ok) throw new MoodleError(`eClass answered HTTP ${res.status}`, { fatal: res.status >= 500 });
    const data = (await res.json()) as { exception?: string; errorcode?: string; message?: string } | null;
    if (data && data.exception) {
      if (data.errorcode === "invalidtoken") throw new MoodleError("That key isn't valid (or has expired). Create a new one on eClass.", { state: "invalid", fatal: true, code: data.errorcode });
      const fatal = /accessexception|webservicesnotenabled/i.test(data.errorcode ?? "");
      throw new MoodleError(`${fn}: ${data.message}`, { fatal, code: data.errorcode });
    }
    return data;
  }
  async function getText(fileurl: string): Promise<string> {
    const res = await fetch(withToken(fileurl));
    if (!res.ok) throw new MoodleError(`HTTP ${res.status}`);
    return res.text();
  }
  /** download to dest atomically; returns bytes written */
  async function download(fileurl: string, dest: string): Promise<number> {
    let res;
    try { res = await fetch(withToken(fileurl)); } catch (e) { throw new MoodleError(`network: ${reason(e)}`, { state: "offline" }); }
    if (!res.ok) throw new MoodleError(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string; errorcode?: string };
      throw new MoodleError(j.error || j.message || "eClass refused the download", { code: j.errorcode });
    }
    mkdirSync(dirname(dest), { recursive: true });
    const tmp = `${dest}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(tmp));
      renameSync(tmp, dest);
    } catch (e) { rmSync(tmp, { force: true }); throw e; }
    return Number(res.headers.get("content-length") ?? 0);
  }
  return { call, download, getText, site };
}

// ---------- text helpers ----------
const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
export const strip = (h: unknown = "") => decode(String(h).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** HTML → readable plain text that keeps paragraphs and list items */
export function htmlToText(h: unknown = ""): string {
  return decode(String(h)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|h\d|li|tr|table|ul|ol|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
export const links = (h: unknown = "") => [...String(h).matchAll(/(?:href|src)=["']([^"']+)["']/gi)].map((m) => decode(m[1]!)).filter((u) => /^https?:/i.test(u));

/** Same slug rule as packages/content (and the original importer). */
export function slug(s: unknown, n = 60): string {
  const cleaned = String(s).replace(/[^\p{L}\p{N}_\s.-]/gu, "").trim().replace(/\s+/g, "-");
  return cleaned.slice(0, n).replace(/^-+|-+$/g, "") || "section";
}
export const safeName = (s: unknown) => String(s).replace(/[\/\\:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "_").trim() || "file";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** unix seconds → "Thursday, 22 October 2026, 9:59 PM" (the format eClass pages show, read by packages/content) */
export function eclassDate(sec: number): string {
  const d = new Date(sec * 1000);
  const h = d.getHours() % 12 || 12;
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
}
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
