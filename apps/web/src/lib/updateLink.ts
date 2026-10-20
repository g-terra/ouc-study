/**
 * Which assignment an update is about (a grade, feedback, a deadline change, a submission, a new assignment),
 * so the update can open it. No imports beyond types: unit-tested on its own (apps/web/test/update-link.test.ts).
 */
import type { Assignment, UpdateItem } from "@ouc/content/types";

const PREFIX = /^(New grade: |Tutor feedback on |Feedback on |Deadline changed: |New assignment: )/;
const norm = (s = "") => s.replace(/\s+/g, " ").trim().toLowerCase();
const eclassId = (url = "") => /mod\/assign\/view\.php\?id=(\d+)/.exec(url)?.[1];

export function assignmentFor(assignments: Assignment[], u: UpdateItem): Assignment | undefined {
  if (!["grade", "feedback", "deadline", "submission", "assignment"].includes(u.type)) return undefined;
  const mine = assignments.filter((a) => a.code === u.code);
  // the eClass link names the assignment exactly
  const id = eclassId(u.url);
  const byLink = id ? mine.find((a) => eclassId(a.eclassUrl) === id) : undefined;
  if (byLink) return byLink;
  const name = norm(u.type === "submission" ? u.title.replace(/: (submitted ✓|[^:]*)$/, "") : u.title.replace(PREFIX, ""));
  return name ? mine.find((a) => norm(a.fullTitle) === name || norm(a.title) === name) : undefined;
}
