/**
 * The v2 preview lives under /v2/<sem>/… next to the classic pages. Pages shared by both (a note, a quiz,
 * an assignment, slides) link with classic paths, so while v2 is open, links are mapped here to stay in v2.
 * No imports: unit-tested on its own (apps/web/test/v2-paths.test.ts).
 */
export const V2 = "/v2";

/** v2 sections: classic pages that v2 folds into another one map to it. */
export const V2_SECTIONS = ["", "courses", "calendar"] as const;

export const isV2 = (path: string) => path === V2 || path.startsWith(`${V2}/`) || path.startsWith(`${V2}#`);

const split = (to: string) => {
  const i = to.indexOf("#");
  return i < 0 ? { p: to, h: "" } : { p: to.slice(0, i), h: to.slice(i) };
};

/** A classic app path → the same page in v2. Files, the API and outside links are left alone. */
export function toV2(to: string): string {
  if (!to.startsWith("/") || to.startsWith("//") || isV2(to) || /^\/(files|api|data)\//.test(to)) return to;
  const { p, h } = split(to);
  const [sem, section, ...rest] = p.split("/").filter(Boolean);
  if (!sem) return V2 + h;
  const base = `${V2}/${sem}`;
  if (!rest.length) {
    if (section === "timeline" || section === "assignments") return `${base}/calendar${h}`;
    if (section === "updates") return `${base}/notifications${h}`;
    if (section === "notes" || section === "quizzes") return `${base}/courses${h}`;
  }
  return [base, section, ...rest].filter(Boolean).join("/") + h;
}

/** A v2 path → the closest classic page (for "Back to the classic view"). */
export function toClassic(path: string): string {
  if (!isV2(path)) return path;
  const { p, h } = split(path);
  const [, sem, section, ...rest] = p.split("/").filter(Boolean);
  if (!sem) return "/";
  // the classic look has no Settings page (its settings are the ⚙️ button), so that one opens the dashboard
  const top: Record<string, string | undefined> = { calendar: "timeline", notifications: "updates", inbox: "updates", settings: undefined };
  const mapped = !rest.length && section !== undefined && section in top ? top[section] : section;
  return `/${[sem, mapped, ...rest].filter(Boolean).join("/")}${h}`;
}

/** The v2 section a path is in ("" for Today), for the nav; pages from the header (notifications, settings) are in none. */
export function v2Section(path: string, from?: string): string {
  const [, , section] = split(path).p.split("/").filter(Boolean);
  // an assignment opened from a course stays under Courses
  if (section === "assignments" && from && v2Section(from) === "courses") return "courses";
  const parent: Record<string, string> = { notes: "courses", quizzes: "courses", slides: "courses", video: "courses", assignments: "calendar", plan: "", "ai-work": "" };
  return section in parent ? parent[section] : section ?? "";
}
