import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeFor } from "../src/grades.ts";

const rows = [
  { code: "ABC101", item: "Essay 1", cmid: 70, grade: "8.00", feedback: "Clear argument." },
  { code: "ABC101", item: "Assignment  2", grade: "7.50" },
  { code: "ABC101", item: "Quiz", grade: "" },
  { code: "XYZ999", item: "Essay 1", grade: "5.00" },
];

test("an assignment gets its gradebook grade by eClass id, else by name", () => {
  assert.equal(gradeFor(rows, "ABC101", "70", "Renamed")?.feedback, "Clear argument.");
  assert.equal(gradeFor(rows, "ABC101", undefined, "assignment 2")?.grade, "7.50");
  assert.equal(gradeFor(rows, "XYZ999", "70", "Essay 1")?.grade, "5.00");
  // no grade yet, or nothing that matches
  assert.equal(gradeFor(rows, "ABC101", undefined, "Quiz"), undefined);
  assert.equal(gradeFor(rows, "ABC101", "71", "Essay 9"), undefined);
});
