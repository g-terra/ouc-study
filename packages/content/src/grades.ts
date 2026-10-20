/** Grades from the eClass gradebook (live.json), matched to an assignment. No imports: unit-tested on its own. */
export interface GradebookRow { code: string; item: string; cmid?: number | string; grade: string; feedback?: string }

export const sameName = (a = "", b = "") => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/** The gradebook row of an assignment (by its eClass id, else its name), when it has a grade. */
export function gradeFor(rows: GradebookRow[], code: string, cmid: string | undefined, name: string): GradebookRow | undefined {
  const graded = rows.filter((g) => g.code === code && g.grade);
  return (cmid ? graded.find((g) => g.cmid !== undefined && String(g.cmid) === cmid) : undefined) ?? graded.find((g) => sameName(g.item, name));
}
