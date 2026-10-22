/** What changed since the last backup, and the one-line summary shown in Settings and the commit message. */

export interface FileEntry { path: string; size: number; mtimeMs: number }
export interface Changes { added: string[]; changed: string[]; removed: string[] }

export function diffFiles(before: FileEntry[], after: FileEntry[]): Changes {
  const old = new Map(before.map((f) => [f.path, f]));
  const now = new Set(after.map((f) => f.path));
  const added: string[] = [];
  const changed: string[] = [];
  for (const f of after) {
    const o = old.get(f.path);
    if (!o) added.push(f.path);
    else if (o.size !== f.size || o.mtimeMs !== f.mtimeMs) changed.push(f.path);
  }
  return { added, changed, removed: before.filter((f) => !now.has(f.path)).map((f) => f.path) };
}

// kinds in the order the summary names them; counted ones say "3 notes", the rest just their name
const KINDS: { re: RegExp; one: string; many?: string }[] = [
  { re: /^semesters\/[^/]+\/notes\//, one: "note", many: "notes" },
  { re: /^semesters\/[^/]+\/courses\/.*\.transcript\.md$/, one: "transcript", many: "transcripts" },
  { re: /^semesters\/[^/]+\/courses\//, one: "course file", many: "course files" },
  { re: /^semesters\/[^/]+\/quizzes\/attempts\.json$/, one: "quiz scores" },
  { re: /^semesters\/[^/]+\/quizzes\//, one: "quiz", many: "quizzes" },
  { re: /\/homework\/answers\.json$/, one: "homework answers" },
  { re: /^semesters\/[^/]+\/assignments\//, one: "assignment file", many: "assignment files" },
  { re: /^semesters\/[^/]+\/progress\.json$/, one: "progress" },
  { re: /^semesters\/[^/]+\/(_meta|updates)\//, one: "eClass data" },
  { re: /^semesters\/[^/]+\/plans\//, one: "plan", many: "plans" },
  { re: /^(memory\/|STUDENT\.md$|CLAUDE\.local\.md$)/, one: "study memory" },
  { re: /^\.ouc\/chats\//, one: "chat", many: "chats" },
  { re: /^\.ouc\//, one: "settings" },
];

export function summarize(c: Changes): string {
  const counts = new Map<number, number>();
  let other = 0;
  for (const p of [...c.added, ...c.changed, ...c.removed]) {
    const i = KINDS.findIndex((k) => k.re.test(p));
    if (i < 0) other++;
    else counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  const parts = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([i, n]) => {
    const k = KINDS[i];
    return k.many ? `${n} ${n === 1 ? k.one : k.many}` : k.one;
  });
  if (other) parts.push(`${other} other file${other === 1 ? "" : "s"}`);
  return parts.join(", ") || "no changes";
}
