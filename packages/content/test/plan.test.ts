// Week plans: parsing the plan file into sections and tasks, and ticking a task in the file.
import test from "node:test";
import assert from "node:assert/strict";
import { isoWeekRange, parsePlan, setTask } from "../src/plan.ts";

const SRC = `---
week: 2026-W42
updated: 2026-10-18
---
# Week 42 plan

Two submissions cluster at the end of the month.

## Next actions
- [ ] Draft both answers for \`semesters/2026-Fall/assignments/COS511/10-26_Assignment-3\`
- [x] Read the brief

## Due soon
| Course | Item | Due |
|---|---|---|
| COS511 | Assignment 3 | Mon 26 Oct |

## Day by day
### Mon 19 Oct
- [ ] 19:00–21:00 COS511 A3: question 1
### Tue 20 Oct
Rest day.

## Risks
- Three deadlines between 26 and 29 Oct.

\`\`\`
- [ ] not a task inside a code block
\`\`\`
`;

test("ISO week range", () => {
  assert.deepEqual(isoWeekRange(2026, 42), { start: "2026-10-12", end: "2026-10-18" });
  assert.deepEqual(isoWeekRange(2026, 1), { start: "2025-12-29", end: "2026-01-04" });
});

test("a plan becomes sections, days and tasks with their line numbers", () => {
  const p = parsePlan(SRC, "2026-W42.md");
  assert.equal(p.week, "2026-W42");
  assert.equal(p.title, "Week 42 plan");
  assert.equal(p.updated, "2026-10-18");
  assert.equal(p.start, "2026-10-12");
  assert.deepEqual(p.intro, [{ md: "Two submissions cluster at the end of the month." }]);
  assert.deepEqual(p.sections.map((s) => s.title), ["Next actions", "Due soon", "Day by day", "Risks"]);
  const [first, second] = p.sections[0].parts;
  assert.equal(first.task!.line, 10);
  assert.match(first.task!.text, /^Draft both answers/);
  assert.equal(first.task!.done, false);
  assert.equal(second.task!.done, true);
  assert.deepEqual(p.sections[2].days.map((d) => d.title), ["Mon 19 Oct", "Tue 20 Oct"]);
  assert.equal(p.sections[2].days[0].parts[0].task!.line, 20);
  assert.deepEqual(p.sections[2].days[1].parts, [{ md: "Rest day." }]);
  assert.match(p.sections[3].parts.at(-1)!.md!, /not a task inside a code block/);   // fenced code stays text
  assert.deepEqual([p.done, p.total], [1, 3]);
});

test("ticking a task rewrites only that line", () => {
  const ticked = setTask(SRC, 10, true)!;
  assert.match(ticked.split("\n")[9], /^- \[x\] Draft both answers/);
  assert.equal(ticked.split("\n").filter((l, i) => l !== SRC.split("\n")[i]).length, 1);
  assert.match(setTask(ticked, 10, false)!.split("\n")[9], /^- \[ \] Draft/);
  assert.equal(setTask(SRC, 5, true), null);   // a heading, not a task
  assert.equal(setTask(SRC, 999, true), null);
});
