// The daily sync's change detection (src/daily.ts diff), on small made-up snapshots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { diff, type Snapshot } from "../src/daily.ts";

const snap = (s: Partial<Snapshot> = {}): Snapshot => ({ userid: 1, user: "Test Student", grades: {}, assignments: {}, modules: {}, files: {}, discussions: {}, notifications: {}, events: {}, courses: {}, ...s });
const kinds = (items: { type: string; title: string }[]) => items.map((i) => `${i.type}: ${i.title}`);

test("nothing changed: no items", () => {
  const s = snap({ modules: { 5: { code: "ABC101", name: "Week 1", type: "resource", section: "Week 1", url: "u" } } });
  assert.deepEqual(diff(s, s), []);
});

test("grades, deadlines, submissions and feedback", () => {
  const assign = { code: "ABC101", id: 7, cmid: 70, name: "Essay 1", due: "2026-11-01T23:59:00", url: "https://x/a", status: "new" };
  const prev = snap({ assignments: { 70: assign }, grades: { "ABC101:1": { code: "ABC101", item: "Essay 1", cmid: 70, grade: "", feedback: "" } } });
  const cur = snap({
    assignments: { 70: { ...assign, due: "2026-11-03T23:59:00", status: "submitted", submittedAt: "2026-10-30T10:00:00.000Z", grade: "8.00", feedback: "Good work" } },
    grades: { "ABC101:1": { code: "ABC101", item: "Essay 1", cmid: 70, grade: "8.00", feedback: "" } },
  });
  const items = diff(prev, cur);
  assert.deepEqual(kinds(items), [
    "grade: New grade: Essay 1",
    "deadline: Deadline changed: Essay 1",
    "submission: Essay 1: submitted ✓",
    "feedback: Tutor feedback on Essay 1",
  ]);
  assert.equal(items[1]!.detail, "2026-11-01 23:59 → 2026-11-03 23:59");
  assert.ok(items.every((i) => i.code === "ABC101" && i.at));
});

test("new material, updated files, forum posts, notifications and events", () => {
  const prev = snap({
    modules: { 5: { code: "ABC101", name: "Slides", type: "folder", section: "Week 1", url: "u5" } },
    files: { "5:a.pdf": { code: "ABC101", module: "Slides", file: "a.pdf", modified: 100 } },
    discussions: { 9: { code: "ABC101", forum: "Q&A", subject: "Exam?", text: "When?", modified: 100, url: "d9", announcement: false } },
  });
  const cur = snap({
    modules: { ...prev.modules, 6: { code: "ABC101", name: "Notes", type: "resource", section: "Week 2", url: "u6" }, 8: { code: "ABC101", name: "Essay", type: "assign", section: "Week 2", url: "u8" } },
    files: { "5:a.pdf": { code: "ABC101", module: "Slides", file: "a.pdf", modified: 200 }, "5:b.pdf": { code: "ABC101", module: "Slides", file: "b.pdf", modified: 200 } },
    discussions: { 9: { ...prev.discussions![9]!, modified: 150 }, 10: { code: "ABC101", forum: "News", subject: "Welcome", by: "Tutor", text: "Hello", url: "d10", announcement: true } },
    notifications: { 3: { subject: "", text: "Something" } },
    events: { 4: { code: "ABC101", name: "Quiz 1", at: "2026-11-05T10:00:00" }, 5: { code: "ABC101", name: "Essay due", module: "assign" } },
  });
  assert.deepEqual(kinds(diff(prev, cur)), [
    "material: New file: Notes",
    "material: Updated file: a.pdf",
    "material: New file in Slides: b.pdf",
    "forum: New replies: Exam?",
    "announcement: Announcement: Welcome",
    "notification: eClass notification",
    "event: Upcoming: Quiz 1",
  ]);
});
