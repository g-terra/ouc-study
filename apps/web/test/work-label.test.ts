// What the background work list calls each job (lib/ai.ts workLabel).
import { test } from "node:test";
import assert from "node:assert/strict";
import { workLabel } from "../src/lib/ai.ts";
import type { SemesterData } from "@ouc/content/types";

test("adding sources to an old note is named after the note", () => {
  const data = { courses: [{ code: "AAA", short: "Testing", weeks: [] }], assignments: [], notes: [{ code: "AAA", slug: "week-01-intro", title: "Week 1 · Intro" }] } as unknown as SemesterData;
  assert.equal(workLabel("sources:AAA/week-01-intro", data), "Sources · Week 1 · Intro");
  assert.equal(workLabel("sources:AAA/gone", data), "Sources · gone");
  assert.equal(workLabel("notes:AAA", data), "Notes · Testing");
});
