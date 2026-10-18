// Shared Moodle web-service client (zero dependencies). Used by pull.mjs and bin/setup.mjs.
// The key is only ever sent to the eClass site, never logged or printed.
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const SITE = process.env.ECLASS_URL ?? "https://eclass.ouc.ac.cy";
export const TOKEN_RE = /^[a-f0-9]{32}$/i;
export const pad = (n) => String(n).padStart(2, "0");

export function readToken(root) {
  const f = join(root, ".eclass-token");
  if (!existsSync(f)) return null;
  const t = readFileSync(f, "utf8").trim();
  return TOKEN_RE.test(t) ? t : null;
}

function encodeParams(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === "object") encodeParams(v, key, out);
    else out.append(key, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  return out;
}

export class MoodleError extends Error {
  constructor(msg, { state = "error", fatal = false, code } = {}) { super(msg); this.state = state; this.fatal = fatal; this.code = code; }
}

export function createClient(token, site = SITE) {
  const withToken = (url) => {
    // pluginfile.php only accepts the key on the web-service variant of the URL
    const u = url.replace(/\/pluginfile\.php\//, "/webservice/pluginfile.php/").replace("/webservice/webservice/", "/webservice/");
    return `${u}${u.includes("?") ? "&" : "?"}token=${token}`;
  };
  async function call(fn, params = {}) {
    const body = encodeParams({ wstoken: token, wsfunction: fn, moodlewsrestformat: "json", ...params });
    let res;
    try {
      res = await fetch(`${site}/webservice/rest/server.php`, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    } catch (e) {
      throw new MoodleError(`Can't reach eClass (${e.cause?.code ?? e.message}). Are you online?`, { state: "offline", fatal: true });
    }
    if (!res.ok) throw new MoodleError(`eClass answered HTTP ${res.status}`, { fatal: res.status >= 500 });
    const data = await res.json();
    if (data && data.exception) {
      if (data.errorcode === "invalidtoken") throw new MoodleError("That key isn't valid (or has expired). Create a new one on eClass.", { state: "invalid", fatal: true, code: data.errorcode });
      const fatal = /accessexception|webservicesnotenabled/i.test(data.errorcode ?? "");
      throw new MoodleError(`${fn}: ${data.message}`, { fatal, code: data.errorcode });
    }
    return data;
  }
  async function getText(fileurl) {
    const res = await fetch(withToken(fileurl));
    if (!res.ok) throw new MoodleError(`HTTP ${res.status}`);
    return res.text();
  }
  /** download to dest atomically; returns bytes written */
  async function download(fileurl, dest) {
    let res;
    try { res = await fetch(withToken(fileurl)); } catch (e) { throw new MoodleError(`network: ${e.cause?.code ?? e.message}`, { state: "offline" }); }
    if (!res.ok) throw new MoodleError(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const j = await res.json().catch(() => ({}));
      throw new MoodleError(j.error || j.message || "eClass refused the download", { code: j.errorcode });
    }
    mkdirSync(dirname(dest), { recursive: true });
    const tmp = `${dest}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
      renameSync(tmp, dest);
    } catch (e) { rmSync(tmp, { force: true }); throw e; }
    return Number(res.headers.get("content-length") ?? 0);
  }
  return { call, download, getText, site };
}

// ---------- text helpers ----------
const ENT = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
export const strip = (h = "") => decode(String(h).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** HTML → readable plain text that keeps paragraphs and list items */
export function htmlToText(h = "") {
  return decode(String(h)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|h\d|li|tr|table|ul|ol|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
export const links = (h = "") => [...String(h).matchAll(/(?:href|src)=["']([^"']+)["']/gi)].map((m) => decode(m[1])).filter((u) => /^https?:/i.test(u));

/** Same slug rule as packages/content (and the original importer). */
export function slug(s, n = 60) {
  const cleaned = String(s).replace(/[^\p{L}\p{N}_\s.-]/gu, "").trim().replace(/\s+/g, "-");
  return cleaned.slice(0, n).replace(/^-+|-+$/g, "") || "section";
}
export const safeName = (s) => String(s).replace(/[\/\\:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "_").trim() || "file";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** unix seconds → "Thursday, 22 October 2026, 9:59 PM" (the format eClass pages show, read by packages/content) */
export function eclassDate(sec) {
  const d = new Date(sec * 1000);
  const h = d.getHours() % 12 || 12;
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
}
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
