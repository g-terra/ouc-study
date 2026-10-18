// Finds the semester, course, week and the text of its material, so a model without file
// tools gets exactly what it needs. Reads the app data built by packages/content.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const pad = (n) => String(n).padStart(2, "0");
export const slug = (s, n = 40) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-").slice(0, n).replace(/-+$/, "") || "note";
export const read = (p, d = "") => { try { return readFileSync(p, "utf8"); } catch { return d; } };

export function currentSemesterId(root) {
  const m = read(join(root, "STUDENT.md")).match(/semesters\/([\w.-]+)\//);
  if (m && existsSync(join(root, "semesters", m[1], "semester.json"))) return m[1];
  const dir = join(root, "semesters");
  const today = new Date().toISOString().slice(0, 10);
  const sems = (existsSync(dir) ? readdirSync(dir) : []).filter((d) => existsSync(join(dir, d, "semester.json")))
    .map((id) => ({ id, ...JSON.parse(read(join(dir, id, "semester.json"), "{}")) })).sort((a, b) => String(a.start).localeCompare(b.start));
  return (sems.find((s) => s.start <= today && today <= s.end) ?? sems.at(-1))?.id ?? null;
}

export function loadData(root, semId) {
  const p = join(root, "apps/web/public/data", `${semId}.json`);
  if (!existsSync(p)) {
    const tsx = join(root, "node_modules/tsx/dist/cli.mjs");
    if (existsSync(tsx)) spawnSync(process.execPath, [tsx, "packages/content/src/build.ts"], { cwd: root, stdio: "ignore" });
  }
  if (!existsSync(p)) throw new Error(`No app data for ${semId} yet. Run: npm run content`);
  return JSON.parse(readFileSync(p, "utf8"));
}

export function findCourse(data, q) {
  if (!q) return null;
  const s = q.toLowerCase();
  return data.courses.find((c) => c.code.toLowerCase() === s)
    ?? data.courses.find((c) => c.short.toLowerCase().includes(s) || c.title.toLowerCase().includes(s))
    ?? data.courses.find((c) => c.code.toLowerCase().includes(s));
}

/** the number a week is known by ("Week 3", "Lecture 5"), else its eClass index */
export const weekNumber = (w) => Number((`${w.name} ${w.label}`.match(/\b(?:week|lecture)\s*(\d+)/i) ?? [])[1] ?? w.index);

export function findWeek(course, q, notes = []) {
  const weeks = course.weeks.filter((w) => w.index > 0);
  if (q !== undefined && q !== null && q !== "") {
    const n = Number(String(q).replace(/\D/g, ""));
    return weeks.find((w) => weekNumber(w) === n && /\b(week|lecture)\s*\d+/i.test(`${w.name} ${w.label}`)) ?? weeks.find((w) => w.index === n) ?? null;
  }
  // default: the latest week that has started, has files and has no note yet
  const today = new Date().toISOString().slice(0, 10);
  const started = weeks.filter((w) => !w.start || w.start <= today);
  const has = (w) => w.items.some((i) => i.kind === "file");
  return [...started].reverse().find((w) => has(w) && !notes.some((n) => n.code === course.code && n.weekIndex === w.index))
    ?? [...started].reverse().find(has) ?? started.at(-1) ?? null;
}

/** text of a week's files (from text/ copies), trimmed to a character budget */
export function weekMaterial(root, semId, week, budget = 48000) {
  const sem = join(root, "semesters", semId);
  const files = week.items.filter((i) => i.kind === "file" && i.href?.startsWith("/files/"))
    .map((i) => ({ title: i.title, rel: decodeURIComponent(i.href.split("/").slice(3).join("/")) }));
  const sources = [], missing = [];
  for (const f of files) {
    let text = "";
    if (f.rel.startsWith("courses/")) text = read(join(sem, "text", `${f.rel.slice(8)}.txt`));
    if (!text && /\.(md|txt|csv)$/i.test(f.rel)) text = read(join(sem, f.rel));
    if (text.trim()) sources.push({ ...f, text: text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() });
    else if (!/\.(png|jpe?g|gif|svg|mp4|zip)$/i.test(f.rel)) missing.push(f.rel);
  }
  const total = sources.reduce((n, s) => n + s.text.length, 0);
  if (total > budget) for (const s of sources) s.text = `${s.text.slice(0, Math.max(1500, Math.floor((s.text.length / total) * budget)))}\n[… trimmed]`;
  return { sources, missing, main: sources[0]?.rel ?? files[0]?.rel };
}

export const noteFileName = (course, week, label) => {
  const lec = /lecture/i.test(`${week.name} ${week.label}`) || label === "lecture";
  const topic = String(week.label).replace(/^(week|lecture)\s*\d+\s*[:.·-]?\s*/i, "").replace(/^\d+\.\s*/, "");
  return `${lec ? "lecture" : "week"}-${pad(weekNumber(week))}-${slug(topic, 30)}.md`;
};
